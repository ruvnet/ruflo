# engine/result.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""Define generic result set constructs."""

from __future__ import annotations

from enum import Enum
import functools
import itertools
import operator
import typing
from typing import Any
from typing import Callable
from typing import cast
from typing import Dict
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
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from .row import Row
from .row import RowMapping
from .. import exc
from .. import util
from ..sql.base import _generative
from ..sql.base import HasMemoized
from ..sql.base import InPlaceGenerative
from ..util import HasMemoized_ro_memoized_attribute
from ..util import NONE_SET
from ..util._has_cy import HAS_CYEXTENSION
from ..util.typing import Literal
from ..util.typing import Self

if typing.TYPE_CHECKING or not HAS_CYEXTENSION:
    from ._py_row import tuplegetter as tuplegetter
else:
    from sqlalchemy.cyextension.resultproxy import tuplegetter as tuplegetter

if typing.TYPE_CHECKING:
    from ..sql.schema import Column
    from ..sql.type_api import _ResultProcessorType

_KeyType = Union[str, "Column[Any]"]
_KeyIndexType = Union[str, "Column[Any]", int]

# is overridden in cursor using _CursorKeyMapRecType
_KeyMapRecType = Any

_KeyMapType = Mapping[_KeyType, _KeyMapRecType]


_RowData = Union[Row[Any], RowMapping, Any]
"""A generic form of "row" that accommodates for the different kinds of
"rows" that different result objects return, including row, row mapping, and
scalar values"""

_RawRowType = Tuple[Any, ...]
"""represents the kind of row we get from a DBAPI cursor"""

_R = TypeVar("_R", bound=_RowData)
_T = TypeVar("_T", bound=Any)
_TP = TypeVar("_TP", bound=Tuple[Any, ...])

_InterimRowType = Union[_R, _RawRowType]
"""a catchall "anything" kind of return type that can be applied
across all the result types

"""

_InterimSupportsScalarsRowType = Union[Row[Any], Any]

_ProcessorsType = Sequence[Optional["_ResultProcessorType[Any]"]]
_TupleGetterType = Callable[[Sequence[Any]], Sequence[Any]]
_UniqueFilterType = Callable[[Any], Any]
_UniqueFilterStateType = Tuple[Set[Any], Optional[_UniqueFilterType]]


class ResultMetaData:
    """Base for metadata about result rows."""

    __slots__ = ()

    _tuplefilter: Optional[_TupleGetterType] = None
    _translated_indexes: Optional[Sequence[int]] = None
    _unique_filters: Optional[Sequence[Callable[[Any], Any]]] = None
    _keymap: _KeyMapType
    _keys: Sequence[str]
    _processors: Optional[_ProcessorsType]
    _key_to_index: Mapping[_KeyType, int]

    @property
    def keys(self) -> RMKeyView:
        return RMKeyView(self)

    def _has_key(self, key: object) -> bool:
        raise NotImplementedError()

    def _for_freeze(self) -> ResultMetaData:
        raise NotImplementedError()

    @overload
    def _key_fallback(
        self, key: Any, err: Optional[Exception], raiseerr: Literal[True] = ...
    ) -> NoReturn:
        ...

    @overload
    def _key_fallback(
        self,
        key: Any,
        err: Optional[Exception],
        raiseerr: Literal[False] = ...,
    ) -> None:
        ...

    @overload
    def _key_fallback(
        self, key: Any, err: Optional[Exception], raiseerr: bool = ...
    ) -> Optional[NoReturn]:
        ...

    def _key_fallback(
        self, key: Any, err: Optional[Exception], raiseerr: bool = True
    ) -> Optional[NoReturn]:
        assert raiseerr
        raise KeyError(key) from err

    def _raise_for_ambiguous_column_name(
        self, rec: _KeyMapRecType
    ) -> NoReturn:
        raise NotImplementedError(
            "ambiguous column name logic is implemented for "
            "CursorResultMetaData"
        )

    def _index_for_key(
        self, key: _KeyIndexType, raiseerr: bool
    ) -> Optional[int]:
        raise NotImplementedError()

    def _indexes_for_keys(
        self, keys: Sequence[_KeyIndexType]
    ) -> Sequence[int]:
        raise NotImplementedError()

    def _metadata_for_keys(
        self, keys: Sequence[_KeyIndexType]
    ) -> Iterator[_KeyMapRecType]:
        raise NotImplementedError()

    def _reduce(self, keys: Sequence[_KeyIndexType]) -> ResultMetaData:
        raise NotImplementedError()

    def _getter(
        self, key: Any, raiseerr: bool = True
    ) -> Optional[Callable[[Row[Any]], Any]]:
        index = self._index_for_key(key, raiseerr)

        if index is not None:
            return operator.itemgetter(index)
        else:
            return None

    def _row_as_tuple_getter(
        self, keys: Sequence[_KeyIndexType]
    ) -> _TupleGetterType:
        indexes = self._indexes_for_keys(keys)
        return tuplegetter(*indexes)

    def _make_key_to_index(
        self, keymap: Mapping[_KeyType, Sequence[Any]], index: int
    ) -> Mapping[_KeyType, int]:
        return {
            key: rec[index]
            for key, rec in keymap.items()
            if rec[index] is not None
        }

    def _key_not_found(self, key: Any, attr_error: bool) -> NoReturn:
        if key in self._keymap:
            # the index must be none in this case
            self._raise_for_ambiguous_column_name(self._keymap[key])
        else:
            # unknown key
            if attr_error:
                try:
                    self._key_fallback(key, None)
                except KeyError as ke:
                    raise AttributeError(ke.args[0]) from ke
            else:
                self._key_fallback(key, None)

    @property
    def _effective_processors(self) -> Optional[_ProcessorsType]:
        if not self._processors or NONE_SET.issuperset(self._processors):
            return None
        else:
            return self._processors


class RMKeyView(typing.KeysView[Any]):
    __slots__ = ("_parent", "_keys")

    _parent: ResultMetaData
    _keys: Sequence[str]

    def __init__(self, parent: ResultMetaData):
        self._parent = parent
        self._keys = [k for k in parent._keys if k is not None]

    def __len__(self) -> int:
        return len(self._keys)

    def __repr__(self) -> str:
        return "{0.__class__.__name__}({0._keys!r})".format(self)

    def __iter__(self) -> Iterator[str]:
        return iter(self._keys)

    def __contains__(self, item: Any) -> bool:
        if isinstance(item, int):
            return False

        # note this also includes special key fallback behaviors
        # which also don't seem to be tested in test_resultset right now
        return self._parent._has_key(item)

    def __eq__(self, other: Any) -> bool:
        return list(other) == list(self)

    def __ne__(self, other: Any) -> bool:
        return list(other) != list(self)


class SimpleResultMetaData(ResultMetaData):
    """result metadata for in-memory collections."""

    __slots__ = (
        "_keys",
        "_keymap",
        "_processors",
        "_tuplefilter",
        "_translated_indexes",
        "_unique_filters",
        "_key_to_index",
    )

    _keys: Sequence[str]

    def __init__(
        self,
        keys: Sequence[str],
        extra: Optional[Sequence[Any]] = None,
        _processors: Optional[_ProcessorsType] = None,
        _tuplefilter: Optional[_TupleGetterType] = None,
        _translated_indexes: Optional[Sequence[int]] = None,
        _unique_filters: Optional[Sequence[Callable[[Any], Any]]] = None,
    ):
        self._keys = list(keys)
        self._tuplefilter = _tuplefilter
        self._translated_indexes = _translated_indexes
        self._unique_filters = _unique_filters
        if extra:
            recs_names = [
                (
                    (name,) + (extras if extras else ()),
                    (index, name, extras),
                )
                for index, (name, extras) in enumerate(zip(self._keys, extra))
            ]
        else:
            recs_names = [
                ((name,), (index, name, ()))
                for index, name in enumerate(self._keys)
            ]

        self._keymap = {key: rec for keys, rec in recs_names for key in keys}

        self._processors = _processors

        self._key_to_index = self._make_key_to_index(self._keymap, 0)

    def _has_key(self, key: object) -> bool:
        return key in self._keymap

    def _for_freeze(self) -> ResultMetaData:
        unique_filters = self._unique_filters
        if unique_filters and self._tuplefilter:
            unique_filters = self._tuplefilter(unique_filters)

        # TODO: are we freezing the result with or without uniqueness
        # applied?
        return SimpleResultMetaData(
            self._keys,
            extra=[self._keymap[key][2] for key in self._keys],
            _unique_filters=unique_filters,
        )

    def __getstate__(self) -> Dict[str, Any]:
        return {
            "_keys": self._keys,
            "_translated_indexes": self._translated_indexes,
        }

    def __setstate__(self, state: Dict[str, Any]) -> None:
        if state["_translated_indexes"]:
            _translated_indexes = state["_translated_indexes"]
            _tuplefilter = tuplegetter(*_translated_indexes)
        else:
            _translated_indexes = _tuplefilter = None
        self.__init__(  # type: ignore
            state["_keys"],
            _translated_indexes=_translated_indexes,
            _tuplefilter=_tuplefilter,
        )

    def _index_for_key(self, key: Any, raiseerr: bool = True) -> int:
        if int in key.__class__.__mro__:
            key = self._keys[key]
        try:
            rec = self._keymap[key]
        except KeyError as ke:
            rec = self._key_fallback(key, ke, raiseerr)

        return rec[0]  # type: ignore[no-any-return]

    def _indexes_for_keys(self, keys: Sequence[Any]) -> Sequence[int]:
        return [self._keymap[key][0] for key in keys]

    def _metadata_for_keys(
        self, keys: Sequence[Any]
    ) -> Iterator[_KeyMapRecType]:
        for key in keys:
            if int in key.__class__.__mro__:
                key = self._keys[key]

            try:
                rec = self._keymap[key]
            except KeyError as ke:
                rec = self._key_fallback(key, ke, True)

            yield rec

    def _reduce(self, keys: Sequence[Any]) -> ResultMetaData:
        try:
            metadata_for_keys = [
                self._keymap[
                    self._keys[key] if int in key.__class__.__mro__ else key
                ]
                for key in keys
            ]
        except KeyError as ke:
            self._key_fallback(ke.args[0], ke, True)

        indexes: Sequence[int]
        new_keys: Sequence[str]
        extra: Sequence[Any]
        indexes, new_keys, extra = zip(*metadata_for_keys)

        if self._translated_indexes:
            indexes = [self._translated_indexes[idx] for idx in indexes]

        tup = tuplegetter(*indexes)

        new_metadata = SimpleResultMetaData(
            new_keys,
            extra=extra,
            _tuplefilter=tup,
            _translated_indexes=indexes,
            _processors=self._processors,
            _unique_filters=self._unique_filters,
        )

        return new_metadata


def result_tuple(
    fields: Sequence[str], extra: Optional[Any] = None
) -> Callable[[Iterable[Any]], Row[Any]]:
    parent = SimpleResultMetaData(fields, extra)
    return functools.partial(
        Row, parent, parent._effective_processors, parent._key_to_index
    )


# a symbol that indicates to internal Result methods that
# "no row is returned".  We can't use None for those cases where a scalar
# filter is applied to rows.
class _NoRow(Enum):
    _NO_ROW = 0


_NO_ROW = _NoRow._NO_ROW


class ResultInternal(InPlaceGenerative, Generic[_R]):
    __slots__ = ()

    _real_result: Optional[Result[Any]] = None
    _generate_rows: bool = True
    _row_logging_fn: Optional[Callable[[Any], Any]]

    _unique_filter_state: Optional[_UniqueFilterStateType] = None
    _post_creational_filter: Optional[Callable[[Any], Any]] = None
    _is_cursor = False

    _metadata: ResultMetaData

    _source_supports_scalars: bool

    def _fetchiter_impl(self) -> Iterator[_InterimRowType[Row[Any]]]:
        raise NotImplementedError()

    def _fetchone_impl(
        self, hard_close: bool = False
    ) -> Optional[_InterimRowType[Row[Any]]]:
        raise NotImplementedError()

    def _fetchmany_impl(
        self, size: Optional[int] = None
    ) -> List[_InterimRowType[Row[Any]]]:
        raise NotImplementedError()

    def _fetchall_impl(self) -> List[_InterimRowType[Row[Any]]]:
        raise NotImplementedError()

    def _soft_close(self, hard: bool = False) -> None:
        raise NotImplementedError()

    @HasMemoized_ro_memoized_attribute
    def _row_getter(self) -> Optional[Callable[..., _R]]:
        real_result: Result[Any] = (
            self._real_result
            if self._real_result
            else cast("Result[Any]", self)
        )

        if real_result._source_supports_scalars:
            if not self._generate_rows:
                return None
            else:
                _proc = Row

                def process_row(
                    metadata: ResultMetaData,
                    processors: Optional[_ProcessorsType],
                    key_to_index: Mapping[_KeyType, int],
                    scalar_obj: Any,
                ) -> Row[Any]:
                    return _proc(
                        metadata, processors, key_to_index, (scalar_obj,)
                    )

        else:
            process_row = Row  # type: ignore

        metadata = self._metadata

        key_to_index = metadata._key_to_index
        processors = metadata._effective_processors
        tf = metadata._tuplefilter

        if tf and not real_result._source_supports_scalars:
            if processors:
                processors = tf(processors)

            _make_row_orig: Callable[..., _R] = functools.partial(  # type: ignore  # noqa E501
                process_row, metadata, processors, key_to_index
            )

            fixed_tf = tf

            def make_row(row: _InterimRowType[Row[Any]]) -> _R:
                return _make_row_orig(fixed_tf(row))

        else:
            make_row = functools.partial(  # type: ignore
                process_row, metadata, processors, key_to_index
            )

        if real_result._row_logging_fn:
            _log_row = real_result._row_logging_fn
            _make_row = make_row

            def make_row(row: _InterimRowType[Row[Any]]) -> _R:
                return _log_row(_make_row(row))  # type: ignore

        return make_row

    @HasMemoized_ro_memoized_attribute
    def _iterator_getter(self) -> Callable[..., Iterator[_R]]:
        make_row = self._row_getter

        post_creational_filter = self._post_creational_filter

        if self._unique_filter_state:
            uniques, strategy = self._unique_strategy

            def iterrows(self: Result[Any]) -> Iterator[_R]:
                for raw_row in self._fetchiter_impl():
                    obj: _InterimRowType[Any] = (
                        make_row(raw_row) if make_row else raw_row
                    )
                    hashed = strategy(obj) if strategy else obj
                    if hashed in uniques:
                        continue
                    uniques.add(hashed)
                    if post_creational_filter:
                        obj = post_creational_filter(obj)
                    yield obj  # type: ignore

        else:

            def iterrows(self: Result[Any]) -> Iterator[_R]:
                for raw_row in self._fetchiter_impl():
                    row: _InterimRowType[Any] = (
                        make_row(raw_row) if make_row else raw_row
                    )
                    if post_creational_filter:
                        row = post_creational_filter(row)
                    yield row  # type: ignore

        return iterrows

    def _raw_all_rows(self) -> List[_R]:
        make_row = self._row_getter
        assert make_row is not None
        rows = self._fetchall_impl()
        return [make_row(row) for row in rows]

    def _allrows(self) -> List[_R]:
        post_creational_filter = self._post_creational_filter

        make_row = self._row_getter

        rows = self._fetchall_impl()
        made_rows: List[_InterimRowType[_R]]
        if make_row:
            made_rows = [make_row(row) for row in rows]
        else:
            made_rows = rows  # type: ignore

        interim_rows: List[_R]

        if self._unique_filter_state:
            uniques, strategy = self._unique_strategy

            interim_rows = [
                made_row  # type: ignore
                for made_row, sig_row in [
                    (
                        made_row,
                        strategy(made_row) if strategy else made_row,
                    )
                    for made_row in made_rows
                ]
                if sig_row not in uniques and not uniques.add(sig_row)  # type: ignore # noqa: E501
            ]
        else:
            interim_rows = made_rows  # type: ignore

        if post_creational_filter:
            interim_rows = [
                post_creational_filter(row) for row in interim_rows
            ]
        return interim_rows

    @HasMemoized_ro_memoized_attribute
    def _onerow_getter(
        self,
    ) -> Callable[..., Union[Literal[_NoRow._NO_ROW], _R]]:
        make_row = self._row_getter

        post_creational_filter = self._post_creational_filter

        if self._unique_filter_state:
            uniques, strategy = self._unique_strategy

            def onerow(self: Result[Any]) -> Union[_NoRow, _R]:
                _onerow = self._fetchone_impl
                while True:
                    row = _onerow()
                    if row is None:
                        return _NO_ROW
                    else:
                        obj: _InterimRowType[Any] = (
                            make_row(row) if make_row else row
                        )
                        hashed = strategy(obj) if strategy else obj
                        if hashed in uniques:
                            continue
                        else:
                            uniques.add(hashed)
                        if post_creational_filter:
                            obj = post_creational_filter(obj)
                        return obj  # type: ignore

        else:

            def onerow(self: Result[Any]) -> Union[_NoRow, _R]:
                row = self._fetchone_impl()
                if row is None:
                    return _NO_ROW
                else:
                    interim_row: _InterimRowType[Any] = (
                        make_row(row) if make_row else row
                    )
                    if post_creational_filter:
                        interim_row = post_creational_filter(interim_row)
                    return interim_row  # type: ignore

        return onerow

    @HasMemoized_ro_memoized_attribute
    def _manyrow_getter(self) -> Callable[..., List[_R]]:
        make_row = self._row_getter

        post_creational_filter = self._post_creational_filter

        if self._unique_filter_state:
            uniques, strategy = self._unique_strategy

            def filterrows(
                make_row: Optional[Callable[..., _R]],
                rows: List[Any],
                strategy: Optional[Callable[[List[Any]], Any]],
                uniques: Set[Any],
            ) -> List[_R]:
                if make_row:
                    rows = [make_row(row) for row in rows]

                if strategy:
                    made_rows = (
                        (made_row, strategy(made_row)) for made_row in rows
                    )
                else:
                    made_rows = ((made_row, made_row) for made_row in rows)
                return [
                    made_row
                    for made_row, sig_row in made_rows
                    if sig_row not in uniques and not uniques.add(sig_row)  # type: ignore  # noqa: E501
                ]

            def manyrows(
                self: ResultInternal[_R], num: Optional[int]
            ) -> List[_R]:
                collect: List[_R] = []

                _manyrows = self._fetchmany_impl

                if num is None:
                    # if None is passed, we don't know the default
                    # manyrows number, DBAPI has this as cursor.arraysize
                    # different DBAPIs / fetch strategies may be different.
                    # do a fetch to find what the number is.  if there are
                    # only fewer rows left, then it doesn't matter.
                    real_result = (
                        self._real_result
                        if self._real_result
                        else cast("Result[Any]", self)
                    )
                    if real_result._yield_per:
                        num_required = num = real_result._yield_per
                    else:
                        rows = _manyrows(num)
                        num = len(rows)
                        assert make_row is not None
                        collect.extend(
                            filterrows(make_row, rows, strategy, uniques)
                        )
                        num_required = num - len(collect)
                else:
                    num_required = num

                assert num is not None

                while num_required:
                    rows = _manyrows(num_required)
                    if not rows:
                        break

                    collect.extend(
                        filterrows(make_row, rows, strategy, uniques)
                    )
                    num_required = num - len(collect)

                if post_creational_filter:
                    collect = [post_creational_filter(row) for row in collect]
                return collect

        else:

            def manyrows(
                self: ResultInternal[_R], num: Optional[int]
            ) -> List[_R]:
                if num is None:
                    real_result = (
                        self._real_result
                        if self._real_result
                        else cast("Result[Any]", self)
                    )
                    num = real_result._yield_per

                rows: List[_InterimRowType[Any]] = self._fetchmany_impl(num)
                if make_row:
                    rows = [make_row(row) for row in rows]
                if post_creational_filter:
                    rows = [post_creational_filter(row) for row in rows]
                return rows  # type: ignore

        return manyrows

    @overload
    def _only_one_row(
        self,
        raise_for_second_row: bool,
        raise_for_none: Literal[True],
        scalar: bool,
    ) -> _R:
        ...

    @overload
    def _only_one_row(
        self,
        raise_for_second_row: bool,
        raise_for_none: bool,
        scalar: bool,
    ) -> Optional[_R]:
        ...

    def _only_one_row(
        self,
        raise_for_second_row: bool,
        raise_for_none: bool,
        scalar: bool,
    ) -> Optional[_R]:
        onerow = self._fetchone_impl

        row: Optional[_InterimRowType[Any]] = onerow(hard_close=True)
        if row is None:
            if raise_for_none:
                raise exc.NoResultFound(
                    "No row was found when one was required"
                )
            else:
                return None

        if scalar and self._source_supports_scalars:
            self._generate_rows = False
            make_row = None
        else:
            make_row = self._row_getter

        try:
            row = make_row(row) if make_row else row
        except:
            self._soft_close(hard=True)
            raise

        if raise_for_second_row:
            if self._unique_filter_state:
                # for no second row but uniqueness, need to essentially
                # consume the entire result :(
                uniques, strategy = self._unique_strategy

                existing_row_hash = strategy(row) if strategy else row

                while True:
                    next_row: Any = onerow(hard_close=True)
                    if next_row is None:
                        next_row = _NO_ROW
                        break

                    try:
                        next_row = make_row(next_row) if make_row else next_row

                        if strategy:
                            assert next_row is not _NO_ROW
                            if existing_row_hash == strategy(next_row):
                                continue
                        elif row == next_row:
                            continue
                        # here, we have a row and it's different
                        break
                    except:
                        self._soft_close(hard=True)
                        raise
            else:
                next_row = onerow(hard_close=True)
                if next_row is None:
                    next_row = _NO_ROW

            if next_row is not _NO_ROW:
                self._soft_close(hard=True)
                raise exc.MultipleResultsFound(
                    "Multiple rows were found when exactly one was required"
                    if raise_for_none
                    else "Multiple rows were found when one or none "
                    "was required"
                )
        else:
            next_row = _NO_ROW
            # if we checked for second row then that would have
            # closed us :)
            self._soft_close(hard=True)

        if not scalar:
            post_creational_filter = self._post_creational_filter
            if post_creational_filter:
                row = post_creational_filter(row)

        if scalar and make_row:
            return row[0]  # type: ignore
        else:
            return row  # type: ignore

    def _iter_impl(self) -> Iterator[_R]:
        return self._iterator_getter(self)

    def _next_impl(self) -> _R:
        row = self._onerow_getter(self)
        if row is _NO_ROW:
            raise StopIteration()
        else:
            return row

    @_generative
    def _column_slices(self, indexes: Sequence[_KeyIndexType]) -> Self:
        real_result = (
            self._real_result
            if self._real_result
            else cast("Result[Any]", self)
        )

        if not real_result._source_supports_scalars or len(indexes) != 1:
            self._metadata = self._metadata._reduce(indexes)

        assert self._generate_rows

        return self

    @HasMemoized.memoized_attribute
    def _unique_strategy(self) -> _UniqueFilterStateType:
        assert self._unique_filter_state is not None
        uniques, strategy = self._unique_filter_state

        real_result = (
            self._real_result
            if self._real_result is not None
            else cast("Result[Any]", self)
        )

        if not strategy and self._metadata._unique_filters:
            if (
                real_result._source_supports_scalars
                and not self._generate_rows
            ):
                strategy = self._metadata._unique_filters[0]
            else:
                filters = self._metadata._unique_filters
                if self._metadata._tuplefilter:
                    filters = self._metadata._tuplefilter(filters)

                strategy = operator.methodcaller("_filter_on_values", filters)
        return uniques, strategy


class _WithKeys:
    __slots__ = ()

    _metadata: ResultMetaData

    # used mainly to share documentation on the keys method.
    def keys(self) -> RMKeyView:
        """Return an iterable view which yields the string keys that would
        be represented by each :class:`_engine.Row`.

        The keys can represent the labels of the columns returned by a core
        statement or the names of the orm classes returned by an orm
        execution.

        The view also can be tested for key containment using the Python
        ``in`` operator, which will test both for the string keys represented
        in the view, as well as for alternate keys such as column objects.

        .. versionchanged:: 1.4 a key view object is returned rather than a
           plain list.


        """
        return self._metadata.keys


class Result(_WithKeys, ResultInternal[Row[_TP]]):
    """Represent a set of database results.

    .. versionadded:: 1.4  The :class:`_engine.Result` object provides a
       completely updated usage model and calling facade for SQLAlchemy
       Core and SQLAlchemy ORM.   In Core, it forms the basis of the
       :class:`_engine.CursorResult` object which replaces the previous
       :class:`_engine.ResultProxy` interface.   When using the ORM, a
       higher level object called :class:`_engine.ChunkedIteratorResult`
       is normally used.

    .. note:: In SQLAlchemy 1.4 and above, this object is
       used for ORM results returned by :meth:`_orm.Session.execute`, which can
       yield instances of ORM mapped objects either individually or within
       tuple-like rows. Note that the :class:`_engine.Result` object does not
       deduplicate instances or rows automatically as is the case with the
       legacy :class:`_orm.Query` object. For in-Python de-duplication of
       instances or rows, use the :meth:`_engine.Result.unique` modifier
       method.

    .. seealso::

        :ref:`tutorial_fetching_rows` - in the :doc:`/tutorial/index`

    """

    __slots__ = ("_metadata", "__dict__")

    _row_logging_fn: Optional[Callable[[Row[Any]], Row[Any]]] = None

    _source_supports_scalars: bool = False

    _yield_per: Optional[int] = None

    _attributes: util.immutabledict[Any, Any] = util.immutabledict()

    def __init__(self, cursor_metadata: ResultMetaData):
        self._metadata = cursor_metadata

    def __enter__(self) -> Self:
        return self

    def __exit__(self, type_: Any, value: Any, traceback: Any) -> None:
        self.close()

    def close(self) -> None:
        """close this :class:`_engine.Result`.

        The behavior of this method is implementation specific, and is
        not implemented by default.    The method should generally end
        the resources in use by the result object and also cause any
        subsequent iteration or row fetching to raise
        :class:`.ResourceClosedError`.

        .. versionadded:: 1.4.27 - ``.close()`` was previously not generally
           available for all :class:`_engine.Result` classes, instead only
           being available on the :class:`_engine.CursorResult` returned for
           Core statement executions. As most other result objects, namely the
           ones used by the ORM, are proxying a :class:`_engine.CursorResult`
           in any case, this allows the underlying cursor result to be closed
           from the outside facade for the case when the ORM query is using
           the ``yield_per`` execution option where it does not immediately
           exhaust and autoclose the database cursor.

        """
        self._soft_close(hard=True)

    @property
    def _soft_closed(self) -> bool:
        raise NotImplementedError()

    @property
    def closed(self) -> bool:
        """return ``True`` if this :class:`_engine.Result` reports .closed

        .. versionadded:: 1.4.43

        """
        raise NotImplementedError()

    @_generative
    def yield_per(self, num: int) -> Self:
        """Configure the row-fetching strategy to fetch ``num`` rows at a time.

        This impacts the underlying behavior of the result when iterating over
        the result object, or otherwise making use of  methods such as
        :meth:`_engine.Result.fetchone` that return one row at a time.   Data
        from the underlying cursor or other data source will be buffered up to
        this many rows in memory, and the buffered collection will then be
        yielded out one row at a time or as many rows are requested. Each time
        the buffer clears, it will be refreshed to this many rows or as many
        rows remain if fewer remain.

        The :meth:`_engine.Result.yield_per` method is generally used in
        conjunction with the
        :paramref:`_engine.Connection.execution_options.stream_results`
        execution option, which will allow the database dialect in use to make
        use of a server side cursor, if the DBAPI supports a specific "server
        side cursor" mode separate from its default mode of operation.

        .. tip::

            Consider using the
            :paramref:`_engine.Connection.execution_options.yield_per`
            execution option, which will simultaneously set
            :paramref:`_engine.Connection.execution_options.stream_results`
            to ensure the use of server side cursors, as well as automatically
            invoke the :meth:`_engine.Result.yield_per` method to establish
            a fixed row buffer size at once.

            The :paramref:`_engine.Connection.execution_options.yield_per`
            execution option is available for ORM operations, with
            :class:`_orm.Session`-oriented use described at
            :ref:`orm_queryguide_yield_per`. The Core-only version which works
            with :class:`_engine.Connection` is new as of SQLAlchemy 1.4.40.

        .. versionadded:: 1.4

        :param num: number of rows to fetch each time the buffer is refilled.
         If set to a value below 1, fetches all rows for the next buffer.

        .. seealso::

            :ref:`engine_stream_results` - describes Core behavior for
            :meth:`_engine.Result.yield_per`

            :ref:`orm_queryguide_yield_per` - in the :ref:`queryguide_toplevel`

        """
        self._yield_per = num
        return self

    @_generative
    def unique(self, strategy: Optional[_UniqueFilterType] = None) -> Self:
        """Apply unique filtering to the objects returned by this
        :class:`_engine.Result`.

        When this filter is applied with no arguments, the rows or objects
        returned will filtered such that each row is returned uniquely. The
        algorithm used to determine this uniqueness is by default the Python
        hashing identity of the whole tuple.   In some cases a specialized
        per-entity hashing scheme may be used, such as when using the ORM, a
        scheme is applied which  works against the primary key identity of
        returned objects.

        The unique filter is applied **after all other filters**, which means
        if the columns returned have been refined using a method such as the
        :meth:`_engine.Result.columns` or :meth:`_engine.Result.scalars`
        method, the uniquing is applied to **only the column or columns
        returned**.   This occurs regardless of the order in which these
        methods have been called upon the :class:`_engine.Result` object.

        The unique filter also changes the calculus used for methods like
        :meth:`_engine.Result.fetchmany` and :meth:`_engine.Result.partitions`.
        When using :meth:`_engine.Result.unique`, these methods will continue
        to yield the number of rows or objects requested, after uniquing
        has been applied.  However, this necessarily impacts the buffering
        behavior of the underlying cursor or datasource, such that multiple
        underlying calls to ``cursor.fetchmany()`` may be necessary in order
        to accumulate enough objects in order to provide a unique collection
        of the requested size.

        :param strategy: a callable that will be applied to rows or objects
         being iterated, which should return an object that represents the
         unique value of the row.   A Python ``set()`` is used to store
         these identities.   If not passed, a default uniqueness strategy
         is used which may have been assembled by the source of this
         :class:`_engine.Result` object.

        """
        self._unique_filter_state = (set(), strategy)
        return self

    def columns(self, *col_expressions: _KeyIndexType) -> Self:
        r"""Establish the columns that should be returned in each row.

        This method may be used to limit the columns returned as well
        as to reorder them.   The given list of expressions are normally
        a series of integers or string key names.   They may also be
        appropriate :class:`.ColumnElement` objects which correspond to
        a given statement construct.

        .. versionchanged:: 2.0  Due to a bug in 1.4, the
           :meth:`_engine.Result.columns` method had an incorrect behavior
           where calling upon the method with just one index would cause the
           :class:`_engine.Result` object to yield scalar values rather than
           :class:`_engine.Row` objects.   In version 2.0, this behavior
           has been corrected such that calling upon
           :meth:`_engine.Result.columns` with a single index will
           produce a :class:`_engine.Result` object that continues
           to yield :class:`_engine.Row` objects, which include
           only a single column.

        E.g.::

            statement = select(table.c.x, table.c.y, table.c.z)
            result = connection.execute(statement)

            for z, y in result.columns('z', 'y'):
                # ...


        Example of using the column objects from the statement itself::

            for z, y in result.columns(
                    statement.selected_columns.c.z,
                    statement.selected_columns.c.y
            ):
                # ...

        .. versionadded:: 1.4

        :param \*col_expressions: indicates columns to be returned.  Elements
         may be integer row indexes, string column names, or appropriate
         :class:`.ColumnElement` objects corresponding to a select construct.

        :return: this :class:`_engine.Result` object with the modifications
         given.

        """
        return self._column_slices(col_expressions)

    @overload
    def scalars(self: Result[Tuple[_T]]) -> ScalarResult[_T]:
        ...

    @overload
    def scalars(
        self: Result[Tuple[_T]], index: Literal[0]
    ) -> ScalarResult[_T]:
        ...

    @overload
    def scalars(self, index: _KeyIndexType = 0) -> ScalarResult[Any]:
        ...

    def scalars(self, index: _KeyIndexType = 0) -> ScalarResult[Any]:
        """Return a :class:`_engine.ScalarResult` filtering object which
        will return single elements rather than :class:`_row.Row` objects.

        E.g.::

            >>> result = conn.execute(text("select int_id from table"))
            >>> result.scalars().all()
            [1, 2, 3]

        When results are fetched from the :class:`_engine.ScalarResult`
        filtering object, the single column-row that would be returned by the
        :class:`_engine.Result` is instead returned as the column's value.

        .. versionadded:: 1.4

        :param index: integer or row key indicating the column to be fetched
         from each row, defaults to ``0`` indicating the first column.

        :return: a new :class:`_engine.ScalarResult` filtering object referring
         to this :class:`_engine.Result` object.

        """
        return ScalarResult(self, index)

    def _getter(
        self, key: _KeyIndexType, raiseerr: bool = True
    ) -> Optional[Callable[[Row[Any]], Any]]:
        """return a callable that will retrieve the given key from a
        :class:`_engine.Row`.

        """
        if self._source_supports_scalars:
            raise NotImplementedError(
                "can't use this function in 'only scalars' mode"
            )
        return self._metadata._getter(key, raiseerr)

    def _tuple_getter(self, keys: Sequence[_KeyIndexType]) -> _TupleGetterType:
        """return a callable that will retrieve the given keys from a
        :class:`_engine.Row`.

        """
        if self._source_supports_scalars:
            raise NotImplementedError(
                "can't use this function in 'only scalars' mode"
            )
        return self._metadata._row_as_tuple_getter(keys)

    def mappings(self) -> MappingResult:
        """Apply a mappings filter to returned rows, returning an instance of
        :class:`_engine.MappingResult`.

        When this filter is applied, fetching rows will return
        :class:`_engine.RowMapping` objects instead of :class:`_engine.Row`
        objects.

        .. versionadded:: 1.4

        :return: a new :class:`_engine.MappingResult` filtering object
         referring to this :class:`_engine.Result` object.

        """

        return MappingResult(self)

    @property
    def t(self) -> TupleResult[_TP]:
        """Apply a "typed tuple" typing filter to returned rows.

        The :attr:`_engine.Result.t` attribute is a synonym for
        calling the :meth:`_engine.Result.tuples` method.

        .. versionadded:: 2.0

        """
        return self  # type: ignore

    def tuples(self) -> TupleResult[_TP]:
        """Apply a "typed tuple" typing filter to returned rows.

        This method returns the same :class:`_engine.Result` object
        at runtime,
        however annotates as returning a :class:`_engine.TupleResult` object
        that will indicate to :pep:`484` typing tools that plain typed
        ``Tuple`` instances are returned rather than rows.  This allows
        tuple unpacking and ``__getitem__`` access of :class:`_engine.Row`
        objects to by typed, for those cases where the statement invoked
        itself included typing information.

        .. versionadded:: 2.0

        :return: the :class:`_engine.TupleResult` type at typing time.

        .. seealso::

            :attr:`_engine.Result.t` - shorter synonym

            :attr:`_engine.Row._t` - :class:`_engine.Row` version

        """

        return self  # type: ignore

    def _raw_row_iterator(self) -> Iterator[_RowData]:
        """Return a safe iterator that yields raw row data.

        This is used by the :meth:`_engine.Result.merge` method
        to merge multiple compatible results together.

        """
        raise NotImplementedError()

    def __iter__(self) -> Iterator[Row[_TP]]:
        return self._iter_impl()

    def __next__(self) -> Row[_TP]:
        return self._next_impl()

    def partitions(
        self, size: Optional[int] = None
    ) -> Iterator[Sequence[Row[_TP]]]:
        """Iterate through sub-lists of rows of the size given.

        Each list will be of the size given, excluding the last list to
        be yielded, which may have a small number of rows.  No empty
        lists will be yielded.

        The result object is automatically closed when the iterator
        is fully consumed.

        Note that the backend driver will usually buffer the entire result
        ahead of time unless the
        :paramref:`.Connection.execution_options.stream_results` execution
        option is used indicating that the driver should not pre-buffer
        results, if possible.   Not all drivers support this option and
        the option is silently ignored for those who do not.

        When using the ORM, the :meth:`_engine.Result.partitions` method
        is typically more effective from a memory perspective when it is
        combined with use of the
        :ref:`yield_per execution option <orm_queryguide_yield_per>`,
        which instructs both the DBAPI driver to use server side cursors,
        if available, as well as instructs the ORM loading internals to only
        build a certain amount of ORM objects from a result at a time before
        yielding them out.

        .. versionadded:: 1.4

        :param size: indicate the maximum number of rows to be present
         in each list yielded.  If None, makes use of the value set by
         the :meth:`_engine.Result.yield_per`, method, if it were called,
         or the :paramref:`_engine.Connection.execution_options.yield_per`
         execution option, which is equivalent in this regard.  If
         yield_per weren't set, it makes use of the
         :meth:`_engine.Result.fetchmany` default, which may be backend
         specific and not well defined.

        :return: iterator of lists

        .. seealso::

            :ref:`engine_stream_results`

            :ref:`orm_queryguide_yield_per` - in the :ref:`queryguide_toplevel`

        """

        getter = self._manyrow_getter

        while True:
            partition = getter(self, size)
            if partition:
                yield partition
            else:
                break

    def fetchall(self) -> Sequence[Row[_TP]]:
        """A synonym for the :meth:`_engine.Result.all` method."""

        return self._allrows()

    def fetchone(self) -> Optional[Row[_TP]]:
        """Fetch one row.

        When all rows are exhausted, returns None.

        This method is provided for backwards compatibility with
        SQLAlchemy 1.x.x.

        To fetch the first row of a result only, use the
        :meth:`_engine.Result.first` method.  To iterate through all
        rows, iterate the :class:`_engine.Result` object directly.

        :return: a :class:`_engine.Row` object if no filters are applied,
         or ``None`` if no rows remain.

        """
        row = self._onerow_getter(self)
        if row is _NO_ROW:
            return None
        else:
            return row

    def fetchmany(self, size: Optional[int] = None) -> Sequence[Row[_TP]]:
        """Fetch many rows.

        When all rows are exhausted, returns an empty list.

        This method is provided for backwards compatibility with
        SQLAlchemy 1.x.x.

        To fetch rows in groups, use the :meth:`_engine.Result.partitions`
        method.

        :return: a list of :class:`_engine.Row` objects.

        .. seealso::

            :meth:`_engine.Result.partitions`

        """

        return self._manyrow_getter(self, size)

    def all(self) -> Sequence[Row[_TP]]:
        """Return all rows in a list.

        Closes the result set after invocation.   Subsequent invocations
        will return an empty list.

        .. versionadded:: 1.4

        :return: a list of :class:`_engine.Row` objects.

        .. seealso::

            :ref:`engine_stream_results` - How to stream a large result set
            without loading it completely in python.

        """

        return self._allrows()

    def first(self) -> Optional[Row[_TP]]:
        """Fetch the first row or ``None`` if no row is present.

        Closes the result set and discards remaining rows.

        .. note::  This method returns one **row**, e.g. tuple, by default.
           To return exactly one single scalar value, that is, the first
           column of the first row, use the
           :meth:`_engine.Result.scalar` method,
           or combine :meth:`_engine.Result.scalars` and
           :meth:`_engine.Result.first`.

           Additionally, in contrast to the behavior of the legacy  ORM
           :meth:`_orm.Query.first` method, **no limit is applied** to the
           SQL query which was invoked to produce this
           :class:`_engine.Result`;
           for a DBAPI driver that buffers results in memory before yielding
           rows, all rows will be sent to the Python process and all but
           the first row will be discarded.

           .. seealso::

                :ref:`migration_20_unify_select`

        :return: a :class:`_engine.Row` object, or None
         if no rows remain.

        .. seealso::

            :meth:`_engine.Result.scalar`

            :meth:`_engine.Result.one`

        """

        return self._only_one_row(
            raise_for_second_row=False, raise_for_none=False, scalar=False
        )

    def one_or_none(self) -> Optional[Row[_TP]]:
        """Return at most one result or raise an exception.

        Returns ``None`` if the result has no rows.
        Raises :class:`.MultipleResultsFound`
        if multiple rows are returned.

        .. versionadded:: 1.4

        :return: The first :class:`_engine.Row` or ``None`` if no row
         is available.

        :raises: :class:`.MultipleResultsFound`

        .. seealso::

            :meth:`_engine.Result.first`

            :meth:`_engine.Result.one`

        """
        return self._only_one_row(
            raise_for_second_row=True, raise_for_none=False, scalar=False
        )

    @overload
    def scalar_one(self: Result[Tuple[_T]]) -> _T:
        ...

    @overload
    def scalar_one(self) -> Any:
        ...

    def scalar_one(self) -> Any:
        """Return exactly one scalar result or raise an exception.

        This is equivalent to calling :meth:`_engine.Result.scalars` and
        then :meth:`_engine.Result.one`.

        .. seealso::

            :meth:`_engine.Result.one`

            :meth:`_engine.Result.scalars`

        """
        return self._only_one_row(
            raise_for_second_row=True, raise_for_none=True, scalar=True
        )

    @overload
    def scalar_one_or_none(self: Result[Tuple[_T]]) -> Optional[_T]:
        ...

    @overload
    def scalar_one_or_none(self) -> Optional[Any]:
        ...

    def scalar_one_or_none(self) -> Optional[Any]:
        """Return exactly one scalar result or ``None``.

        This is equivalent to calling :meth:`_engine.Result.scalars` and
        then :meth:`_engine.Result.one_or_none`.

        .. seealso::

            :meth:`_engine.Result.one_or_none`

            :meth:`_engine.Result.scalars`

        """
        return self._only_one_row(
            raise_for_second_row=True, raise_for_none=False, scalar=True
        )

    def one(self) -> Row[_TP]:
        """Return exactly one row or raise an exception.

        Raises :class:`.NoResultFound` if the result returns no
        rows, or :class:`.MultipleResultsFound` if multiple rows
        would be returned.

        .. note::  This method returns one **row**, e.g. tuple, by default.
           To return exactly one single scalar value, that is, the first
           column of the first row, use the
           :meth:`_engine.Result.scalar_one` method, or combine
           :meth:`_engine.Result.scalars` and
           :meth:`_engine.Result.one`.

        .. versionadded:: 1.4

        :return: The first :class:`_engine.Row`.

        :raises: :class:`.MultipleResultsFound`, :class:`.NoResultFound`

        .. seealso::

            :meth:`_engine.Result.first`

            :meth:`_engine.Result.one_or_none`

            :meth:`_engine.Result.scalar_one`

        """
        return self._only_one_row(
            raise_for_second_row=True, raise_for_none=True, scalar=False
        )

    @overload
    def scalar(self: Result[Tuple[_T]]) -> Optional[_T]:
        ...

    @overload
    def scalar(self) -> Any:
        ...

    def scalar(self) -> Any:
        """Fetch the first column of the first row, and close the result set.

        Returns ``None`` if there are no rows to fetch.

        No validation is performed to test if additional rows remain.

        After calling this method, the object is fully closed,
        e.g. the :meth:`_engine.CursorResult.close`
        method will have been called.

        :return: a Python scalar value, or ``None`` if no rows remain.

        """
        return self._only_one_row(
            raise_for_second_row=False, raise_for_none=False, scalar=True
        )

    def freeze(self) -> FrozenResult[_TP]:
        """Return a callable object that will produce copies of this
        :class:`_engine.Result` when invoked.

        The callable object returned is an instance of
        :class:`_engine.FrozenResult`.

        This is used for result set caching.  The method must be called
        on the result when it has been unconsumed, and calling the method
        will consume the result fully.   When the :class:`_engine.FrozenResult`
        is retrieved from a cache, it can be called any number of times where
        it will produce a new :class:`_engine.Result` object each time
        against its stored set of rows.

        .. seealso::

            :ref:`do_orm_execute_re_executing` - example usage within the
            ORM to implement a result-set cache.

        """

        return FrozenResult(self)

    def merge(self, *others: Result[Any]) -> MergedResult[_TP]:
        """Merge this :class:`_engine.Result` with other compatible result
        objects.

        The object returned is an instance of :class:`_engine.MergedResult`,
        which will be composed of iterators from the given result
        objects.

        The new result will use the metadata from this result object.
        The subsequent result objects must be against an identical
        set of result / cursor metadata, otherwise the behavior is
        undefined.

        """
        return MergedResult(self._metadata, (self,) + others)


class FilterResult(ResultInternal[_R]):
    """A wrapper for a :class:`_engine.Result` that returns objects other than
    :class:`_engine.Row` objects, such as dictionaries or scalar objects.

    :class:`_engine.FilterResult` is the common base for additional result
    APIs including :class:`_engine.MappingResult`,
    :class:`_engine.ScalarResult` and :class:`_engine.AsyncResult`.

    """

    __slots__ = (
        "_real_result",
        "_post_creational_filter",
        "_metadata",
        "_unique_filter_state",
        "__dict__",
    )

    _post_creational_filter: Optional[Callable[[Any], Any]]

    _real_result: Result[Any]

    def __enter__(self) -> Self:
        return self

    def __exit__(self, type_: Any, value: Any, traceback: Any) -> None:
        self._real_result.__exit__(type_, value, traceback)

    @_generative
    def yield_per(self, num: int) -> Self:
        """Configure the row-fetching strategy to fetch ``num`` rows at a time.

        The :meth:`_engine.FilterResult.yield_per` method is a pass through
        to the :meth:`_engine.Result.yield_per` method.  See that method's
        documentation for usage notes.

        .. versionadded:: 1.4.40 - added :meth:`_engine.FilterResult.yield_per`
           so that the method is available on all result set implementations

        .. seealso::

            :ref:`engine_stream_results` - describes Core behavior for
            :meth:`_engine.Result.yield_per`

            :ref:`orm_queryguide_yield_per` - in the :ref:`queryguide_toplevel`

        """
        self._real_result = self._real_result.yield_per(num)
        return self

    def _soft_close(self, hard: bool = False) -> None:
        self._real_result._soft_close(hard=hard)

    @property
    def _soft_closed(self) -> bool:
        return self._real_result._soft_closed

    @property
    def closed(self) -> bool:
        """Return ``True`` if the underlying :class:`_engine.Result` reports
        closed

        .. versionadded:: 1.4.43

        """
        return self._real_result.closed

    def close(self) -> None:
        """Close this :class:`_engine.FilterResult`.

        .. versionadded:: 1.4.43

        """
        self._real_result.close()

    @property
    def _attributes(self) -> Dict[Any, Any]:
        return self._real_result._attributes

    def _fetchiter_impl(self) -> Iterator[_InterimRowType[Row[Any]]]:
        return self._real_result._fetchiter_impl()

    def _fetchone_impl(
        self, hard_close: bool = False
    ) -> Optional[_InterimRowType[Row[Any]]]:
        return self._real_result._fetchone_impl(hard_close=hard_close)

    def _fetchall_impl(self) -> List[_InterimRowType[Row[Any]]]:
        return self._real_result._fetchall_impl()

    def _fetchmany_impl(
        self, size: Optional[int] = None
    ) -> List[_InterimRowType[Row[Any]]]:
        return self._real_result._fetchmany_impl(size=size)


class ScalarResult(FilterResult[_R]):
    """A wrapper for a :class:`_engine.Result` that returns scalar values
    rather than :class:`_row.Row` values.

    The :class:`_engine.ScalarResult` object is acquired by calling the
    :meth:`_engine.Result.scalars` method.

    A special limitation of :class:`_engine.ScalarResult` is that it has
    no ``fetchone()`` method; since the semantics of ``fetchone()`` are that
    the ``None`` value indicates no more results, this is not compatible
    with :class:`_engine.ScalarResult` since there is no way to distinguish
    between ``None`` as a row value versus ``None`` as an indicator.  Use
    ``next(result)`` to receive values individually.

    """

    __slots__ = ()

    _generate_rows = False

    _post_creational_filter: Optional[Callable[[Any], Any]]

    def __init__(self, real_result: Result[Any], index: _KeyIndexType):
        self._real_result = real_result

        if real_result._source_supports_scalars:
            self._metadata = real_result._metadata
            self._post_creational_filter = None
        else:
            self._metadata = real_result._metadata._reduce([index])
            self._post_creational_filter = operator.itemgetter(0)

        self._unique_filter_state = real_result._unique_filter_state

    def unique(self, strategy: Optional[_UniqueFilterType] = None) -> Self:
        """Apply unique filtering to the objects returned by this
        :class:`_engine.ScalarResult`.

        See :meth:`_engine.Result.unique` for usage details.

        """
        self._unique_filter_state = (set(), strategy)
        return self

    def partitions(self, size: Optional[int] = None) -> Iterator[Sequence[_R]]:
        """Iterate through sub-lists of elements of the size given.

        Equivalent to :meth:`_engine.Result.partitions` except that
        scalar values, rather than :class:`_engine.Row` objects,
        are returned.

        """

        getter = self._manyrow_getter

        while True:
            partition = getter(self, size)
            if partition:
                yield partition
            else:
                break

    def fetchall(self) -> Sequence[_R]:
        """A synonym for the :meth:`_engine.ScalarResult.all` method."""

        return self._allrows()

    def fetchmany(self, size: Optional[int] = None) -> Sequence[_R]:
        """Fetch many objects.

        Equivalent to :meth:`_engine.Result.fetchmany` except that
        scalar values, rather than :class:`_engine.Row` objects,
        are returned.

        """
        return self._manyrow_getter(self, size)

    def all(self) -> Sequence[_R]:
        """Return all scalar values in a list.

        Equivalent to :meth:`_engine.Result.all` except that
        scalar values, rather than :class:`_engine.Row` objects,
        are returned.

        """
        return self._allrows()

    def __iter__(self) -> Iterator[_R]:
        return self._iter_impl()

    def __next__(self) -> _R:
        return self._next_impl()

    def first(self) -> Optional[_R]:
        """Fetch the first object or ``None`` if no object is present.

        Equivalent to :meth:`_engine.Result.first` except that
        scalar values, rather than :class:`_engine.Row` objects,
        are returned.


        """
        return self._only_one_row(
            raise_for_second_row=False, raise_for_none=False, scalar=False
        )

    def one_or_none(self) -> Optional[_R]:
        """Return at most one object or raise an exception.

        Equivalent to :meth:`_engine.Result.one_or_none` except that
        scalar values, rather than :class:`_engine.Row` objects,
        are returned.

        """
        return self._only_one_row(
            raise_for_second_row=True, raise_for_none=False, scalar=False
        )

    def one(self) -> _R:
        """Return exactly one object or raise an exception.

        Equivalent to :meth:`_engine.Result.one` except that
        scalar values, rather than :class:`_engine.Row` objects,
        are returned.

        """
        return self._only_one_row(
            raise_for_second_row=True, raise_for_none=True, scalar=False
        )


class TupleResult(FilterResult[_R], util.TypingOnly):
    """A :class:`_engine.Result` that's typed as returning plain
    Python tuples instead of rows.

    Since :class:`_engine.Row` acts like a tuple in every way already,
    this class is a typing only class, regular :class:`_engine.Result` is
    still used at runtime.

    """

    __slots__ = ()

    if TYPE_CHECKING:

        def partitions(
            self, size: Optional[int] = None
        ) -> Iterator[Sequence[_R]]:
            """Iterate through sub-lists of elements of the size given.

            Equivalent to :meth:`_engine.Result.partitions` except that
            tuple values, rather than :class:`_engine.Row` objects,
            are returned.

            """
            ...

        def fetchone(self) -> Optional[_R]:
            """Fetch one tuple.

            Equivalent to :meth:`_engine.Result.fetchone` except that
            tuple values, rather than :class:`_engine.Row`
            objects, are returned.

            """
            ...

        def fetchall(self) -> Sequence[_R]:
            """A synonym for the :meth:`_engine.ScalarResult.all` method."""
            ...

        def fetchmany(self, size: Optional[int] = None) -> Sequence[_R]:
            """Fetch many objects.

            Equivalent to :meth:`_engine.Result.fetchmany` except that
            tuple values, rather than :class:`_engine.Row` objects,
            are returned.

            """
            ...

        def all(self) -> Sequence[_R]:  # noqa: A001
            """Return all scalar values in a list.

            Equivalent to :meth:`_engine.Result.all` except that
            tuple values, rather than :class:`_engine.Row` objects,
            are returned.

            """
            ...

        def __iter__(self) -> Iterator[_R]:
            ...

        def __next__(self) -> _R:
            ...

        def first(self) -> Optional[_R]:
            """Fetch the first object or ``None`` if no object is present.

            Equivalent to :meth:`_engine.Result.first` except that
            tuple values, rather than :class:`_engine.Row` objects,
            are returned.


            """
            ...

        def one_or_none(self) -> Optional[_R]:
            """Return at most one object or raise an exception.

            Equivalent to :meth:`_engine.Result.one_or_none` except that
            tuple values, rather than :class:`_engine.Row` objects,
            are returned.

            """
            ...

        def one(self) -> _R:
            """Return exactly one object or raise an exception.

            Equivalent to :meth:`_engine.Result.one` except that
            tuple values, rather than :class:`_engine.Row` objects,
            are returned.

            """
            ...

        @overload
        def scalar_one(self: TupleResult[Tuple[_T]]) -> _T:
            ...

        @overload
        def scalar_one(self) -> Any:
            ...

        def scalar_one(self) -> Any:
            """Return exactly one scalar result or raise an exception.

            This is equivalent to calling :meth:`_engine.Result.scalars`
            and then :meth:`_engine.Result.one`.

            .. seealso::

                :meth:`_engine.Result.one`

                :meth:`_engine.Result.scalars`

            """
            ...

        @overload
        def scalar_one_or_none(self: TupleResult[Tuple[_T]]) -> Optional[_T]:
            ...

        @overload
        def scalar_one_or_none(self) -> Optional[Any]:
            ...

        def scalar_one_or_none(self) -> Optional[Any]:
            """Return exactly one or no scalar result.

            This is equivalent to calling :meth:`_engine.Result.scalars`
            and then :meth:`_engine.Result.one_or_none`.

            .. seealso::

                :meth:`_engine.Result.one_or_none`

                :meth:`_engine.Result.scalars`

            """
            ...

        @overload
        def scalar(self: TupleResult[Tuple[_T]]) -> Optional[_T]:
            ...

        @overload
        def scalar(self) -> Any:
            ...

        def scalar(self) -> Any:
            """Fetch the first column of the first row, and close the result
            set.

            Returns ``None`` if there are no rows to fetch.

            No validation is performed to test if additional rows remain.

            After calling this method, the object is fully closed,
            e.g. the :meth:`_engine.CursorResult.close`
            method will have been called.

            :return: a Python scalar value , or ``None`` if no rows remain.

            """
            ...


class MappingResult(_WithKeys, FilterResult[RowMapping]):
    """A wrapper for a :class:`_engine.Result` that returns dictionary values
    rather than :class:`_engine.Row` values.

    The :class:`_engine.MappingResult` object is acquired by calling the
    :meth:`_engine.Result.mappings` method.

    """

    __slots__ = ()

    _generate_rows = True

    _post_creational_filter = operator.attrgetter("_mapping")

    def __init__(self, result: Result[Any]):
        self._real_result = result
        self._unique_filter_state = result._unique_filter_state
        self._metadata = result._metadata
        if result._source_supports_scalars:
            self._metadata = self._metadata._reduce([0])

    def unique(self, strategy: Optional[_UniqueFilterType] = None) -> Self:
        """Apply unique filtering to the objects returned by this
        :class:`_engine.MappingResult`.

        See :meth:`_engine.Result.unique` for usage details.

        """
        self._unique_filter_state = (set(), strategy)
        return self

    def columns(self, *col_expressions: _KeyIndexType) -> Self:
        r"""Establish the columns that should be returned in each row."""
        return self._column_slices(col_expressions)

    def partitions(
        self, size: Optional[int] = None
    ) -> Iterator[Sequence[RowMapping]]:
        """Iterate through sub-lists of elements of the size given.

        Equivalent to :meth:`_engine.Result.partitions` except that
        :class:`_engine.RowMapping` values, rather than :class:`_engine.Row`
        objects, are returned.

        """

        getter = self._manyrow_getter

        while True:
            partition = getter(self, size)
            if partition:
                yield partition
            else:
                break

    def fetchall(self) -> Sequence[RowMapping]:
        """A synonym for the :meth:`_engine.MappingResult.all` method."""

        return self._allrows()

    def fetchone(self) -> Optional[RowMapping]:
        """Fetch one object.

        Equivalent to :meth:`_engine.Result.fetchone` except that
        :class:`_engine.RowMapping` values, rather than :class:`_engine.Row`
        objects, are returned.

        """

        row = self._onerow_getter(self)
        if row is _NO_ROW:
            return None
        else:
            return row

    def fetchmany(self, size: Optional[int] = None) -> Sequence[RowMapping]:
        """Fetch many objects.

        Equivalent to :meth:`_engine.Result.fetchmany` except that
        :class:`_engine.RowMapping` values, rather than :class:`_engine.Row`
        objects, are returned.

        """

        return self._manyrow_getter(self, size)

    def all(self) -> Sequence[RowMapping]:
        """Return all scalar values in a list.

        Equivalent to :meth:`_engine.Result.all` except that
        :class:`_engine.RowMapping` values, rather than :class:`_engine.Row`
        objects, are returned.

        """

        return self._allrows()

    def __iter__(self) -> Iterator[RowMapping]:
        return self._iter_impl()

    def __next__(self) -> RowMapping:
        return self._next_impl()

    def first(self) -> Optional[RowMapping]:
        """Fetch the first object or ``None`` if no object is present.

        Equivalent to :meth:`_engine.Result.first` except that
        :class:`_engine.RowMapping` values, rather than :class:`_engine.Row`
        objects, are returned.


        """
        return self._only_one_row(
            raise_for_second_row=False, raise_for_none=False, scalar=False
        )

    def one_or_none(self) -> Optional[RowMapping]:
        """Return at most one object or raise an exception.

        Equivalent to :meth:`_engine.Result.one_or_none` except that
        :class:`_engine.RowMapping` values, rather than :class:`_engine.Row`
        objects, are returned.

        """
        return self._only_one_row(
            raise_for_second_row=True, raise_for_none=False, scalar=False
        )

    def one(self) -> RowMapping:
        """Return exactly one object or raise an exception.

        Equivalent to :meth:`_engine.Result.one` except that
        :class:`_engine.RowMapping` values, rather than :class:`_engine.Row`
        objects, are returned.

        """
        return self._only_one_row(
            raise_for_second_row=True, raise_for_none=True, scalar=False
        )


class FrozenResult(Generic[_TP]):
    """Represents a :class:`_engine.Result` object in a "frozen" state suitable
    for caching.

    The :class:`_engine.FrozenResult` object is returned from the
    :meth:`_engine.Result.freeze` method of any :class:`_engine.Result`
    object.

    A new iterable :class:`_engine.Result` object is generated from a fixed
    set of data each time the :class:`_engine.FrozenResult` is invoked as
    a callable::


        result = connection.execute(query)

        frozen = result.freeze()

        unfrozen_result_one = frozen()

        for row in unfrozen_result_one:
            print(row)

        unfrozen_result_two = frozen()
        rows = unfrozen_result_two.all()

        # ... etc

    .. versionadded:: 1.4

    .. seealso::

        :ref:`do_orm_execute_re_executing` - example usage within the
        ORM to implement a result-set cache.

        :func:`_orm.loading.merge_frozen_result` - ORM function to merge
        a frozen result back into a :class:`_orm.Session`.

    """

    data: Sequence[Any]

    def __init__(self, result: Result[_TP]):
        self.metadata = result._metadata._for_freeze()
        self._source_supports_scalars = result._source_supports_scalars
        self._attributes = result._attributes

        if self._source_supports_scalars:
            self.data = list(result._raw_row_iterator())
        else:
            self.data = result.fetchall()

    def rewrite_rows(self) -> Sequence[Sequence[Any]]:
        if self._source_supports_scalars:
            return [[elem] for elem in self.data]
        else:
            return [list(row) for row in self.data]

    def with_new_rows(
        self, tuple_data: Sequence[Row[_TP]]
    ) -> FrozenResult[_TP]:
        fr = FrozenResult.__new__(FrozenResult)
        fr.metadata = self.metadata
        fr._attributes = self._attributes
        fr._source_supports_scalars = self._source_supports_scalars

        if self._source_supports_scalars:
            fr.data = [d[0] for d in tuple_data]
        else:
            fr.data = tuple_data
        return fr

    def __call__(self) -> Result[_TP]:
        result: IteratorResult[_TP] = IteratorResult(
            self.metadata, iter(self.data)
        )
        result._attributes = self._attributes
        result._source_supports_scalars = self._source_supports_scalars
        return result


class IteratorResult(Result[_TP]):
    """A :class:`_engine.Result` that gets data from a Python iterator of
    :class:`_engine.Row` objects or similar row-like data.

    .. versionadded:: 1.4

    """

    _hard_closed = False
    _soft_closed = False

    def __init__(
        self,
        cursor_metadata: ResultMetaData,
        iterator: Iterator[_InterimSupportsScalarsRowType],
        raw: Optional[Result[Any]] = None,
        _source_supports_scalars: bool = False,
    ):
        self._metadata = cursor_metadata
        self.iterator = iterator
        self.raw = raw
        self._source_supports_scalars = _source_supports_scalars

    @property
    def closed(self) -> bool:
        """Return ``True`` if this :class:`_engine.IteratorResult` has
        been closed

        .. versionadded:: 1.4.43

        """
        return self._hard_closed

    def _soft_close(self, hard: bool = False, **kw: Any) -> None:
        if hard:
            self._hard_closed = True
        if self.raw is not None:
            self.raw._soft_close(hard=hard, **kw)
        self.iterator = iter([])
        self._reset_memoizations()
        self._soft_closed = True

    def _raise_hard_closed(self) -> NoReturn:
        raise exc.ResourceClosedError("This result object is closed.")

    def _raw_row_iterator(self) -> Iterator[_RowData]:
        return self.iterator

    def _fetchiter_impl(self) -> Iterator[_InterimSupportsScalarsRowType]:
        if self._hard_closed:
            self._raise_hard_closed()
        return self.iterator

    def _fetchone_impl(
        self, hard_close: bool = False
    ) -> Optional[_InterimRowType[Row[Any]]]:
        if self._hard_closed:
            self._raise_hard_closed()

        row = next(self.iterator, _NO_ROW)
        if row is _NO_ROW:
            self._soft_close(hard=hard_close)
            return None
        else:
            return row

    def _fetchall_impl(self) -> List[_InterimRowType[Row[Any]]]:
        if self._hard_closed:
            self._raise_hard_closed()
        try:
            return list(self.iterator)
        finally:
            self._soft_close()

    def _fetchmany_impl(
        self, size: Optional[int] = None
    ) -> List[_InterimRowType[Row[Any]]]:
        if self._hard_closed:
            self._raise_hard_closed()

        return list(itertools.islice(self.iterator, 0, size))


def null_result() -> IteratorResult[Any]:
    return IteratorResult(SimpleResultMetaData([]), iter([]))


class ChunkedIteratorResult(IteratorResult[_TP]):
    """An :class:`_engine.IteratorResult` that works from an
    iterator-producing callable.

    The given ``chunks`` argument is a function that is given a number of rows
    to return in each chunk, or ``None`` for all rows.  The function should
    then return an un-consumed iterator of lists, each list of the requested
    size.

    The function can be called at any time again, in which case it should
    continue from the same result set but adjust the chunk size as given.

    .. versionadded:: 1.4

    """

    def __init__(
        self,
        cursor_metadata: ResultMetaData,
        chunks: Callable[
            [Optional[int]], Iterator[Sequence[_InterimRowType[_R]]]
        ],
        source_supports_scalars: bool = False,
        raw: Optional[Result[Any]] = None,
        dynamic_yield_per: bool = False,
    ):
        self._metadata = cursor_metadata
        self.chunks = chunks
        self._source_supports_scalars = source_supports_scalars
        self.raw = raw
        self.iterator = itertools.chain.from_iterable(self.chunks(None))
        self.dynamic_yield_per = dynamic_yield_per

    @_generative
    def yield_per(self, num: int) -> Self:
        # TODO: this throws away the iterator which may be holding
        # onto a chunk.   the yield_per cannot be changed once any
        # rows have been fetched.   either find a way to enforce this,
        # or we can't use itertools.chain and will instead have to
        # keep track.

        self._yield_per = num
        self.iterator = itertools.chain.from_iterable(self.chunks(num))
        return self

    def _soft_close(self, hard: bool = False, **kw: Any) -> None:
        super()._soft_close(hard=hard, **kw)
        self.chunks = lambda size: []  # type: ignore

    def _fetchmany_impl(
        self, size: Optional[int] = None
    ) -> List[_InterimRowType[Row[Any]]]:
        if self.dynamic_yield_per:
            self.iterator = itertools.chain.from_iterable(self.chunks(size))
        return super()._fetchmany_impl(size=size)


class MergedResult(IteratorResult[_TP]):
    """A :class:`_engine.Result` that is merged from any number of
    :class:`_engine.Result` objects.

    Returned by the :meth:`_engine.Result.merge` method.

    .. versionadded:: 1.4

    """

    closed = False
    rowcount: Optional[int]

    def __init__(
        self, cursor_metadata: ResultMetaData, results: Sequence[Result[_TP]]
    ):
        self._results = results
        super().__init__(
            cursor_metadata,
            itertools.chain.from_iterable(
                r._raw_row_iterator() for r in results
            ),
        )

        self._unique_filter_state = results[0]._unique_filter_state
        self._yield_per = results[0]._yield_per

        # going to try something w/ this in next rev
        self._source_supports_scalars = results[0]._source_supports_scalars

        self._attributes = self._attributes.merge_with(
            *[r._attributes for r in results]
        )

    def _soft_close(self, hard: bool = False, **kw: Any) -> None:
        for r in self._results:
            r._soft_close(hard=hard, **kw)
        if hard:
            self.closed = True
