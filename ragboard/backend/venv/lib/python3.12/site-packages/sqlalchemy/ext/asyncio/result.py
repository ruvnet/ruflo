# ext/asyncio/result.py
# Copyright (C) 2020-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
from __future__ import annotations

import operator
from typing import Any
from typing import AsyncIterator
from typing import Optional
from typing import overload
from typing import Sequence
from typing import Tuple
from typing import TYPE_CHECKING
from typing import TypeVar

from . import exc as async_exc
from ... import util
from ...engine import Result
from ...engine.result import _NO_ROW
from ...engine.result import _R
from ...engine.result import _WithKeys
from ...engine.result import FilterResult
from ...engine.result import FrozenResult
from ...engine.result import ResultMetaData
from ...engine.row import Row
from ...engine.row import RowMapping
from ...sql.base import _generative
from ...util.concurrency import greenlet_spawn
from ...util.typing import Literal
from ...util.typing import Self

if TYPE_CHECKING:
    from ...engine import CursorResult
    from ...engine.result import _KeyIndexType
    from ...engine.result import _UniqueFilterType

_T = TypeVar("_T", bound=Any)
_TP = TypeVar("_TP", bound=Tuple[Any, ...])


class AsyncCommon(FilterResult[_R]):
    __slots__ = ()

    _real_result: Result[Any]
    _metadata: ResultMetaData

    async def close(self) -> None:  # type: ignore[override]
        """Close this result."""

        await greenlet_spawn(self._real_result.close)

    @property
    def closed(self) -> bool:
        """proxies the .closed attribute of the underlying result object,
        if any, else raises ``AttributeError``.

        .. versionadded:: 2.0.0b3

        """
        return self._real_result.closed


class AsyncResult(_WithKeys, AsyncCommon[Row[_TP]]):
    """An asyncio wrapper around a :class:`_result.Result` object.

    The :class:`_asyncio.AsyncResult` only applies to statement executions that
    use a server-side cursor.  It is returned only from the
    :meth:`_asyncio.AsyncConnection.stream` and
    :meth:`_asyncio.AsyncSession.stream` methods.

    .. note:: As is the case with :class:`_engine.Result`, this object is
       used for ORM results returned by :meth:`_asyncio.AsyncSession.execute`,
       which can yield instances of ORM mapped objects either individually or
       within tuple-like rows.  Note that these result objects do not
       deduplicate instances or rows automatically as is the case with the
       legacy :class:`_orm.Query` object. For in-Python de-duplication of
       instances or rows, use the :meth:`_asyncio.AsyncResult.unique` modifier
       method.

    .. versionadded:: 1.4

    """

    __slots__ = ()

    _real_result: Result[_TP]

    def __init__(self, real_result: Result[_TP]):
        self._real_result = real_result

        self._metadata = real_result._metadata
        self._unique_filter_state = real_result._unique_filter_state
        self._post_creational_filter = None

        # BaseCursorResult pre-generates the "_row_getter".  Use that
        # if available rather than building a second one
        if "_row_getter" in real_result.__dict__:
            self._set_memoized_attribute(
                "_row_getter", real_result.__dict__["_row_getter"]
            )

    @property
    def t(self) -> AsyncTupleResult[_TP]:
        """Apply a "typed tuple" typing filter to returned rows.

        The :attr:`_asyncio.AsyncResult.t` attribute is a synonym for
        calling the :meth:`_asyncio.AsyncResult.tuples` method.

        .. versionadded:: 2.0

        """
        return self  # type: ignore

    def tuples(self) -> AsyncTupleResult[_TP]:
        """Apply a "typed tuple" typing filter to returned rows.

        This method returns the same :class:`_asyncio.AsyncResult` object
        at runtime,
        however annotates as returning a :class:`_asyncio.AsyncTupleResult`
        object that will indicate to :pep:`484` typing tools that plain typed
        ``Tuple`` instances are returned rather than rows.  This allows
        tuple unpacking and ``__getitem__`` access of :class:`_engine.Row`
        objects to by typed, for those cases where the statement invoked
        itself included typing information.

        .. versionadded:: 2.0

        :return: the :class:`_result.AsyncTupleResult` type at typing time.

        .. seealso::

            :attr:`_asyncio.AsyncResult.t` - shorter synonym

            :attr:`_engine.Row.t` - :class:`_engine.Row` version

        """

        return self  # type: ignore

    @_generative
    def unique(self, strategy: Optional[_UniqueFilterType] = None) -> Self:
        """Apply unique filtering to the objects returned by this
        :class:`_asyncio.AsyncResult`.

        Refer to :meth:`_engine.Result.unique` in the synchronous
        SQLAlchemy API for a complete behavioral description.

        """
        self._unique_filter_state = (set(), strategy)
        return self

    def columns(self, *col_expressions: _KeyIndexType) -> Self:
        r"""Establish the columns that should be returned in each row.

        Refer to :meth:`_engine.Result.columns` in the synchronous
        SQLAlchemy API for a complete behavioral description.

        """
        return self._column_slices(col_expressions)

    async def partitions(
        self, size: Optional[int] = None
    ) -> AsyncIterator[Sequence[Row[_TP]]]:
        """Iterate through sub-lists of rows of the size given.

        An async iterator is returned::

            async def scroll_results(connection):
                result = await connection.stream(select(users_table))

                async for partition in result.partitions(100):
                    print("list of rows: %s" % partition)

        Refer to :meth:`_engine.Result.partitions` in the synchronous
        SQLAlchemy API for a complete behavioral description.

        """

        getter = self._manyrow_getter

        while True:
            partition = await greenlet_spawn(getter, self, size)
            if partition:
                yield partition
            else:
                break

    async def fetchall(self) -> Sequence[Row[_TP]]:
        """A synonym for the :meth:`_asyncio.AsyncResult.all` method.

        .. versionadded:: 2.0

        """

        return await greenlet_spawn(self._allrows)

    async def fetchone(self) -> Optional[Row[_TP]]:
        """Fetch one row.

        When all rows are exhausted, returns None.

        This method is provided for backwards compatibility with
        SQLAlchemy 1.x.x.

        To fetch the first row of a result only, use the
        :meth:`_asyncio.AsyncResult.first` method.  To iterate through all
        rows, iterate the :class:`_asyncio.AsyncResult` object directly.

        :return: a :class:`_engine.Row` object if no filters are applied,
         or ``None`` if no rows remain.

        """
        row = await greenlet_spawn(self._onerow_getter, self)
        if row is _NO_ROW:
            return None
        else:
            return row

    async def fetchmany(
        self, size: Optional[int] = None
    ) -> Sequence[Row[_TP]]:
        """Fetch many rows.

        When all rows are exhausted, returns an empty list.

        This method is provided for backwards compatibility with
        SQLAlchemy 1.x.x.

        To fetch rows in groups, use the
        :meth:`._asyncio.AsyncResult.partitions` method.

        :return: a list of :class:`_engine.Row` objects.

        .. seealso::

            :meth:`_asyncio.AsyncResult.partitions`

        """

        return await greenlet_spawn(self._manyrow_getter, self, size)

    async def all(self) -> Sequence[Row[_TP]]:
        """Return all rows in a list.

        Closes the result set after invocation.   Subsequent invocations
        will return an empty list.

        :return: a list of :class:`_engine.Row` objects.

        """

        return await greenlet_spawn(self._allrows)

    def __aiter__(self) -> AsyncResult[_TP]:
        return self

    async def __anext__(self) -> Row[_TP]:
        row = await greenlet_spawn(self._onerow_getter, self)
        if row is _NO_ROW:
            raise StopAsyncIteration()
        else:
            return row

    async def first(self) -> Optional[Row[_TP]]:
        """Fetch the first row or ``None`` if no row is present.

        Closes the result set and discards remaining rows.

        .. note::  This method returns one **row**, e.g. tuple, by default.
           To return exactly one single scalar value, that is, the first
           column of the first row, use the
           :meth:`_asyncio.AsyncResult.scalar` method,
           or combine :meth:`_asyncio.AsyncResult.scalars` and
           :meth:`_asyncio.AsyncResult.first`.

           Additionally, in contrast to the behavior of the legacy  ORM
           :meth:`_orm.Query.first` method, **no limit is applied** to the
           SQL query which was invoked to produce this
           :class:`_asyncio.AsyncResult`;
           for a DBAPI driver that buffers results in memory before yielding
           rows, all rows will be sent to the Python process and all but
           the first row will be discarded.

           .. seealso::

                :ref:`migration_20_unify_select`

        :return: a :class:`_engine.Row` object, or None
         if no rows remain.

        .. seealso::

            :meth:`_asyncio.AsyncResult.scalar`

            :meth:`_asyncio.AsyncResult.one`

        """
        return await greenlet_spawn(self._only_one_row, False, False, False)

    async def one_or_none(self) -> Optional[Row[_TP]]:
        """Return at most one result or raise an exception.

        Returns ``None`` if the result has no rows.
        Raises :class:`.MultipleResultsFound`
        if multiple rows are returned.

        .. versionadded:: 1.4

        :return: The first :class:`_engine.Row` or ``None`` if no row
         is available.

        :raises: :class:`.MultipleResultsFound`

        .. seealso::

            :meth:`_asyncio.AsyncResult.first`

            :meth:`_asyncio.AsyncResult.one`

        """
        return await greenlet_spawn(self._only_one_row, True, False, False)

    @overload
    async def scalar_one(self: AsyncResult[Tuple[_T]]) -> _T:
        ...

    @overload
    async def scalar_one(self) -> Any:
        ...

    async def scalar_one(self) -> Any:
        """Return exactly one scalar result or raise an exception.

        This is equivalent to calling :meth:`_asyncio.AsyncResult.scalars` and
        then :meth:`_asyncio.AsyncResult.one`.

        .. seealso::

            :meth:`_asyncio.AsyncResult.one`

            :meth:`_asyncio.AsyncResult.scalars`

        """
        return await greenlet_spawn(self._only_one_row, True, True, True)

    @overload
    async def scalar_one_or_none(
        self: AsyncResult[Tuple[_T]],
    ) -> Optional[_T]:
        ...

    @overload
    async def scalar_one_or_none(self) -> Optional[Any]:
        ...

    async def scalar_one_or_none(self) -> Optional[Any]:
        """Return exactly one scalar result or ``None``.

        This is equivalent to calling :meth:`_asyncio.AsyncResult.scalars` and
        then :meth:`_asyncio.AsyncResult.one_or_none`.

        .. seealso::

            :meth:`_asyncio.AsyncResult.one_or_none`

            :meth:`_asyncio.AsyncResult.scalars`

        """
        return await greenlet_spawn(self._only_one_row, True, False, True)

    async def one(self) -> Row[_TP]:
        """Return exactly one row or raise an exception.

        Raises :class:`.NoResultFound` if the result returns no
        rows, or :class:`.MultipleResultsFound` if multiple rows
        would be returned.

        .. note::  This method returns one **row**, e.g. tuple, by default.
           To return exactly one single scalar value, that is, the first
           column of the first row, use the
           :meth:`_asyncio.AsyncResult.scalar_one` method, or combine
           :meth:`_asyncio.AsyncResult.scalars` and
           :meth:`_asyncio.AsyncResult.one`.

        .. versionadded:: 1.4

        :return: The first :class:`_engine.Row`.

        :raises: :class:`.MultipleResultsFound`, :class:`.NoResultFound`

        .. seealso::

            :meth:`_asyncio.AsyncResult.first`

            :meth:`_asyncio.AsyncResult.one_or_none`

            :meth:`_asyncio.AsyncResult.scalar_one`

        """
        return await greenlet_spawn(self._only_one_row, True, True, False)

    @overload
    async def scalar(self: AsyncResult[Tuple[_T]]) -> Optional[_T]:
        ...

    @overload
    async def scalar(self) -> Any:
        ...

    async def scalar(self) -> Any:
        """Fetch the first column of the first row, and close the result set.

        Returns ``None`` if there are no rows to fetch.

        No validation is performed to test if additional rows remain.

        After calling this method, the object is fully closed,
        e.g. the :meth:`_engine.CursorResult.close`
        method will have been called.

        :return: a Python scalar value, or ``None`` if no rows remain.

        """
        return await greenlet_spawn(self._only_one_row, False, False, True)

    async def freeze(self) -> FrozenResult[_TP]:
        """Return a callable object that will produce copies of this
        :class:`_asyncio.AsyncResult` when invoked.

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

        return await greenlet_spawn(FrozenResult, self)

    @overload
    def scalars(
        self: AsyncResult[Tuple[_T]], index: Literal[0]
    ) -> AsyncScalarResult[_T]:
        ...

    @overload
    def scalars(self: AsyncResult[Tuple[_T]]) -> AsyncScalarResult[_T]:
        ...

    @overload
    def scalars(self, index: _KeyIndexType = 0) -> AsyncScalarResult[Any]:
        ...

    def scalars(self, index: _KeyIndexType = 0) -> AsyncScalarResult[Any]:
        """Return an :class:`_asyncio.AsyncScalarResult` filtering object which
        will return single elements rather than :class:`_row.Row` objects.

        Refer to :meth:`_result.Result.scalars` in the synchronous
        SQLAlchemy API for a complete behavioral description.

        :param index: integer or row key indicating the column to be fetched
         from each row, defaults to ``0`` indicating the first column.

        :return: a new :class:`_asyncio.AsyncScalarResult` filtering object
         referring to this :class:`_asyncio.AsyncResult` object.

        """
        return AsyncScalarResult(self._real_result, index)

    def mappings(self) -> AsyncMappingResult:
        """Apply a mappings filter to returned rows, returning an instance of
        :class:`_asyncio.AsyncMappingResult`.

        When this filter is applied, fetching rows will return
        :class:`_engine.RowMapping` objects instead of :class:`_engine.Row`
        objects.

        :return: a new :class:`_asyncio.AsyncMappingResult` filtering object
         referring to the underlying :class:`_result.Result` object.

        """

        return AsyncMappingResult(self._real_result)


class AsyncScalarResult(AsyncCommon[_R]):
    """A wrapper for a :class:`_asyncio.AsyncResult` that returns scalar values
    rather than :class:`_row.Row` values.

    The :class:`_asyncio.AsyncScalarResult` object is acquired by calling the
    :meth:`_asyncio.AsyncResult.scalars` method.

    Refer to the :class:`_result.ScalarResult` object in the synchronous
    SQLAlchemy API for a complete behavioral description.

    .. versionadded:: 1.4

    """

    __slots__ = ()

    _generate_rows = False

    def __init__(self, real_result: Result[Any], index: _KeyIndexType):
        self._real_result = real_result

        if real_result._source_supports_scalars:
            self._metadata = real_result._metadata
            self._post_creational_filter = None
        else:
            self._metadata = real_result._metadata._reduce([index])
            self._post_creational_filter = operator.itemgetter(0)

        self._unique_filter_state = real_result._unique_filter_state

    def unique(
        self,
        strategy: Optional[_UniqueFilterType] = None,
    ) -> Self:
        """Apply unique filtering to the objects returned by this
        :class:`_asyncio.AsyncScalarResult`.

        See :meth:`_asyncio.AsyncResult.unique` for usage details.

        """
        self._unique_filter_state = (set(), strategy)
        return self

    async def partitions(
        self, size: Optional[int] = None
    ) -> AsyncIterator[Sequence[_R]]:
        """Iterate through sub-lists of elements of the size given.

        Equivalent to :meth:`_asyncio.AsyncResult.partitions` except that
        scalar values, rather than :class:`_engine.Row` objects,
        are returned.

        """

        getter = self._manyrow_getter

        while True:
            partition = await greenlet_spawn(getter, self, size)
            if partition:
                yield partition
            else:
                break

    async def fetchall(self) -> Sequence[_R]:
        """A synonym for the :meth:`_asyncio.AsyncScalarResult.all` method."""

        return await greenlet_spawn(self._allrows)

    async def fetchmany(self, size: Optional[int] = None) -> Sequence[_R]:
        """Fetch many objects.

        Equivalent to :meth:`_asyncio.AsyncResult.fetchmany` except that
        scalar values, rather than :class:`_engine.Row` objects,
        are returned.

        """
        return await greenlet_spawn(self._manyrow_getter, self, size)

    async def all(self) -> Sequence[_R]:
        """Return all scalar values in a list.

        Equivalent to :meth:`_asyncio.AsyncResult.all` except that
        scalar values, rather than :class:`_engine.Row` objects,
        are returned.

        """
        return await greenlet_spawn(self._allrows)

    def __aiter__(self) -> AsyncScalarResult[_R]:
        return self

    async def __anext__(self) -> _R:
        row = await greenlet_spawn(self._onerow_getter, self)
        if row is _NO_ROW:
            raise StopAsyncIteration()
        else:
            return row

    async def first(self) -> Optional[_R]:
        """Fetch the first object or ``None`` if no object is present.

        Equivalent to :meth:`_asyncio.AsyncResult.first` except that
        scalar values, rather than :class:`_engine.Row` objects,
        are returned.

        """
        return await greenlet_spawn(self._only_one_row, False, False, False)

    async def one_or_none(self) -> Optional[_R]:
        """Return at most one object or raise an exception.

        Equivalent to :meth:`_asyncio.AsyncResult.one_or_none` except that
        scalar values, rather than :class:`_engine.Row` objects,
        are returned.

        """
        return await greenlet_spawn(self._only_one_row, True, False, False)

    async def one(self) -> _R:
        """Return exactly one object or raise an exception.

        Equivalent to :meth:`_asyncio.AsyncResult.one` except that
        scalar values, rather than :class:`_engine.Row` objects,
        are returned.

        """
        return await greenlet_spawn(self._only_one_row, True, True, False)


class AsyncMappingResult(_WithKeys, AsyncCommon[RowMapping]):
    """A wrapper for a :class:`_asyncio.AsyncResult` that returns dictionary
    values rather than :class:`_engine.Row` values.

    The :class:`_asyncio.AsyncMappingResult` object is acquired by calling the
    :meth:`_asyncio.AsyncResult.mappings` method.

    Refer to the :class:`_result.MappingResult` object in the synchronous
    SQLAlchemy API for a complete behavioral description.

    .. versionadded:: 1.4

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

    def unique(
        self,
        strategy: Optional[_UniqueFilterType] = None,
    ) -> Self:
        """Apply unique filtering to the objects returned by this
        :class:`_asyncio.AsyncMappingResult`.

        See :meth:`_asyncio.AsyncResult.unique` for usage details.

        """
        self._unique_filter_state = (set(), strategy)
        return self

    def columns(self, *col_expressions: _KeyIndexType) -> Self:
        r"""Establish the columns that should be returned in each row."""
        return self._column_slices(col_expressions)

    async def partitions(
        self, size: Optional[int] = None
    ) -> AsyncIterator[Sequence[RowMapping]]:
        """Iterate through sub-lists of elements of the size given.

        Equivalent to :meth:`_asyncio.AsyncResult.partitions` except that
        :class:`_engine.RowMapping` values, rather than :class:`_engine.Row`
        objects, are returned.

        """

        getter = self._manyrow_getter

        while True:
            partition = await greenlet_spawn(getter, self, size)
            if partition:
                yield partition
            else:
                break

    async def fetchall(self) -> Sequence[RowMapping]:
        """A synonym for the :meth:`_asyncio.AsyncMappingResult.all` method."""

        return await greenlet_spawn(self._allrows)

    async def fetchone(self) -> Optional[RowMapping]:
        """Fetch one object.

        Equivalent to :meth:`_asyncio.AsyncResult.fetchone` except that
        :class:`_engine.RowMapping` values, rather than :class:`_engine.Row`
        objects, are returned.

        """

        row = await greenlet_spawn(self._onerow_getter, self)
        if row is _NO_ROW:
            return None
        else:
            return row

    async def fetchmany(
        self, size: Optional[int] = None
    ) -> Sequence[RowMapping]:
        """Fetch many rows.

        Equivalent to :meth:`_asyncio.AsyncResult.fetchmany` except that
        :class:`_engine.RowMapping` values, rather than :class:`_engine.Row`
        objects, are returned.

        """

        return await greenlet_spawn(self._manyrow_getter, self, size)

    async def all(self) -> Sequence[RowMapping]:
        """Return all rows in a list.

        Equivalent to :meth:`_asyncio.AsyncResult.all` except that
        :class:`_engine.RowMapping` values, rather than :class:`_engine.Row`
        objects, are returned.

        """

        return await greenlet_spawn(self._allrows)

    def __aiter__(self) -> AsyncMappingResult:
        return self

    async def __anext__(self) -> RowMapping:
        row = await greenlet_spawn(self._onerow_getter, self)
        if row is _NO_ROW:
            raise StopAsyncIteration()
        else:
            return row

    async def first(self) -> Optional[RowMapping]:
        """Fetch the first object or ``None`` if no object is present.

        Equivalent to :meth:`_asyncio.AsyncResult.first` except that
        :class:`_engine.RowMapping` values, rather than :class:`_engine.Row`
        objects, are returned.

        """
        return await greenlet_spawn(self._only_one_row, False, False, False)

    async def one_or_none(self) -> Optional[RowMapping]:
        """Return at most one object or raise an exception.

        Equivalent to :meth:`_asyncio.AsyncResult.one_or_none` except that
        :class:`_engine.RowMapping` values, rather than :class:`_engine.Row`
        objects, are returned.

        """
        return await greenlet_spawn(self._only_one_row, True, False, False)

    async def one(self) -> RowMapping:
        """Return exactly one object or raise an exception.

        Equivalent to :meth:`_asyncio.AsyncResult.one` except that
        :class:`_engine.RowMapping` values, rather than :class:`_engine.Row`
        objects, are returned.

        """
        return await greenlet_spawn(self._only_one_row, True, True, False)


class AsyncTupleResult(AsyncCommon[_R], util.TypingOnly):
    """A :class:`_asyncio.AsyncResult` that's typed as returning plain
    Python tuples instead of rows.

    Since :class:`_engine.Row` acts like a tuple in every way already,
    this class is a typing only class, regular :class:`_asyncio.AsyncResult` is
    still used at runtime.

    """

    __slots__ = ()

    if TYPE_CHECKING:

        async def partitions(
            self, size: Optional[int] = None
        ) -> AsyncIterator[Sequence[_R]]:
            """Iterate through sub-lists of elements of the size given.

            Equivalent to :meth:`_result.Result.partitions` except that
            tuple values, rather than :class:`_engine.Row` objects,
            are returned.

            """
            ...

        async def fetchone(self) -> Optional[_R]:
            """Fetch one tuple.

            Equivalent to :meth:`_result.Result.fetchone` except that
            tuple values, rather than :class:`_engine.Row`
            objects, are returned.

            """
            ...

        async def fetchall(self) -> Sequence[_R]:
            """A synonym for the :meth:`_engine.ScalarResult.all` method."""
            ...

        async def fetchmany(self, size: Optional[int] = None) -> Sequence[_R]:
            """Fetch many objects.

            Equivalent to :meth:`_result.Result.fetchmany` except that
            tuple values, rather than :class:`_engine.Row` objects,
            are returned.

            """
            ...

        async def all(self) -> Sequence[_R]:  # noqa: A001
            """Return all scalar values in a list.

            Equivalent to :meth:`_result.Result.all` except that
            tuple values, rather than :class:`_engine.Row` objects,
            are returned.

            """
            ...

        async def __aiter__(self) -> AsyncIterator[_R]:
            ...

        async def __anext__(self) -> _R:
            ...

        async def first(self) -> Optional[_R]:
            """Fetch the first object or ``None`` if no object is present.

            Equivalent to :meth:`_result.Result.first` except that
            tuple values, rather than :class:`_engine.Row` objects,
            are returned.


            """
            ...

        async def one_or_none(self) -> Optional[_R]:
            """Return at most one object or raise an exception.

            Equivalent to :meth:`_result.Result.one_or_none` except that
            tuple values, rather than :class:`_engine.Row` objects,
            are returned.

            """
            ...

        async def one(self) -> _R:
            """Return exactly one object or raise an exception.

            Equivalent to :meth:`_result.Result.one` except that
            tuple values, rather than :class:`_engine.Row` objects,
            are returned.

            """
            ...

        @overload
        async def scalar_one(self: AsyncTupleResult[Tuple[_T]]) -> _T:
            ...

        @overload
        async def scalar_one(self) -> Any:
            ...

        async def scalar_one(self) -> Any:
            """Return exactly one scalar result or raise an exception.

            This is equivalent to calling :meth:`_engine.Result.scalars`
            and then :meth:`_engine.Result.one`.

            .. seealso::

                :meth:`_engine.Result.one`

                :meth:`_engine.Result.scalars`

            """
            ...

        @overload
        async def scalar_one_or_none(
            self: AsyncTupleResult[Tuple[_T]],
        ) -> Optional[_T]:
            ...

        @overload
        async def scalar_one_or_none(self) -> Optional[Any]:
            ...

        async def scalar_one_or_none(self) -> Optional[Any]:
            """Return exactly one or no scalar result.

            This is equivalent to calling :meth:`_engine.Result.scalars`
            and then :meth:`_engine.Result.one_or_none`.

            .. seealso::

                :meth:`_engine.Result.one_or_none`

                :meth:`_engine.Result.scalars`

            """
            ...

        @overload
        async def scalar(self: AsyncTupleResult[Tuple[_T]]) -> Optional[_T]:
            ...

        @overload
        async def scalar(self) -> Any:
            ...

        async def scalar(self) -> Any:
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


_RT = TypeVar("_RT", bound="Result[Any]")


async def _ensure_sync_result(result: _RT, calling_method: Any) -> _RT:
    cursor_result: CursorResult[Any]

    try:
        is_cursor = result._is_cursor
    except AttributeError:
        # legacy execute(DefaultGenerator) case
        return result

    if not is_cursor:
        cursor_result = getattr(result, "raw", None)  # type: ignore
    else:
        cursor_result = result  # type: ignore
    if cursor_result and cursor_result.context._is_server_side:
        await greenlet_spawn(cursor_result.close)
        raise async_exc.AsyncMethodRequired(
            "Can't use the %s.%s() method with a "
            "server-side cursor. "
            "Use the %s.stream() method for an async "
            "streaming result set."
            % (
                calling_method.__self__.__class__.__name__,
                calling_method.__name__,
                calling_method.__self__.__class__.__name__,
            )
        )
    return result
