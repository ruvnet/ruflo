# ext/asyncio/base.py
# Copyright (C) 2020-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

from __future__ import annotations

import abc
import functools
from typing import Any
from typing import AsyncGenerator
from typing import AsyncIterator
from typing import Awaitable
from typing import Callable
from typing import ClassVar
from typing import Dict
from typing import Generator
from typing import Generic
from typing import NoReturn
from typing import Optional
from typing import overload
from typing import Tuple
from typing import TypeVar
import weakref

from . import exc as async_exc
from ... import util
from ...util.typing import Literal
from ...util.typing import Self

_T = TypeVar("_T", bound=Any)
_T_co = TypeVar("_T_co", bound=Any, covariant=True)


_PT = TypeVar("_PT", bound=Any)


class ReversibleProxy(Generic[_PT]):
    _proxy_objects: ClassVar[
        Dict[weakref.ref[Any], weakref.ref[ReversibleProxy[Any]]]
    ] = {}
    __slots__ = ("__weakref__",)

    @overload
    def _assign_proxied(self, target: _PT) -> _PT:
        ...

    @overload
    def _assign_proxied(self, target: None) -> None:
        ...

    def _assign_proxied(self, target: Optional[_PT]) -> Optional[_PT]:
        if target is not None:
            target_ref: weakref.ref[_PT] = weakref.ref(
                target, ReversibleProxy._target_gced
            )
            proxy_ref = weakref.ref(
                self,
                functools.partial(ReversibleProxy._target_gced, target_ref),
            )
            ReversibleProxy._proxy_objects[target_ref] = proxy_ref

        return target

    @classmethod
    def _target_gced(
        cls,
        ref: weakref.ref[_PT],
        proxy_ref: Optional[weakref.ref[Self]] = None,  # noqa: U100
    ) -> None:
        cls._proxy_objects.pop(ref, None)

    @classmethod
    def _regenerate_proxy_for_target(cls, target: _PT) -> Self:
        raise NotImplementedError()

    @overload
    @classmethod
    def _retrieve_proxy_for_target(
        cls,
        target: _PT,
        regenerate: Literal[True] = ...,
    ) -> Self:
        ...

    @overload
    @classmethod
    def _retrieve_proxy_for_target(
        cls, target: _PT, regenerate: bool = True
    ) -> Optional[Self]:
        ...

    @classmethod
    def _retrieve_proxy_for_target(
        cls, target: _PT, regenerate: bool = True
    ) -> Optional[Self]:
        try:
            proxy_ref = cls._proxy_objects[weakref.ref(target)]
        except KeyError:
            pass
        else:
            proxy = proxy_ref()
            if proxy is not None:
                return proxy  # type: ignore

        if regenerate:
            return cls._regenerate_proxy_for_target(target)
        else:
            return None


class StartableContext(Awaitable[_T_co], abc.ABC):
    __slots__ = ()

    @abc.abstractmethod
    async def start(self, is_ctxmanager: bool = False) -> _T_co:
        raise NotImplementedError()

    def __await__(self) -> Generator[Any, Any, _T_co]:
        return self.start().__await__()

    async def __aenter__(self) -> _T_co:
        return await self.start(is_ctxmanager=True)

    @abc.abstractmethod
    async def __aexit__(
        self, type_: Any, value: Any, traceback: Any
    ) -> Optional[bool]:
        pass

    def _raise_for_not_started(self) -> NoReturn:
        raise async_exc.AsyncContextNotStarted(
            "%s context has not been started and object has not been awaited."
            % (self.__class__.__name__)
        )


class GeneratorStartableContext(StartableContext[_T_co]):
    __slots__ = ("gen",)

    gen: AsyncGenerator[_T_co, Any]

    def __init__(
        self,
        func: Callable[..., AsyncIterator[_T_co]],
        args: Tuple[Any, ...],
        kwds: Dict[str, Any],
    ):
        self.gen = func(*args, **kwds)  # type: ignore

    async def start(self, is_ctxmanager: bool = False) -> _T_co:
        try:
            start_value = await util.anext_(self.gen)
        except StopAsyncIteration:
            raise RuntimeError("generator didn't yield") from None

        # if not a context manager, then interrupt the generator, don't
        # let it complete.   this step is technically not needed, as the
        # generator will close in any case at gc time.  not clear if having
        # this here is a good idea or not (though it helps for clarity IMO)
        if not is_ctxmanager:
            await self.gen.aclose()

        return start_value

    async def __aexit__(
        self, typ: Any, value: Any, traceback: Any
    ) -> Optional[bool]:
        # vendored from contextlib.py
        if typ is None:
            try:
                await util.anext_(self.gen)
            except StopAsyncIteration:
                return False
            else:
                raise RuntimeError("generator didn't stop")
        else:
            if value is None:
                # Need to force instantiation so we can reliably
                # tell if we get the same exception back
                value = typ()
            try:
                await self.gen.athrow(value)
            except StopAsyncIteration as exc:
                # Suppress StopIteration *unless* it's the same exception that
                # was passed to throw().  This prevents a StopIteration
                # raised inside the "with" statement from being suppressed.
                return exc is not value
            except RuntimeError as exc:
                # Don't re-raise the passed in exception. (issue27122)
                if exc is value:
                    return False
                # Avoid suppressing if a Stop(Async)Iteration exception
                # was passed to athrow() and later wrapped into a RuntimeError
                # (see PEP 479 for sync generators; async generators also
                # have this behavior). But do this only if the exception
                # wrapped
                # by the RuntimeError is actully Stop(Async)Iteration (see
                # issue29692).
                if (
                    isinstance(value, (StopIteration, StopAsyncIteration))
                    and exc.__cause__ is value
                ):
                    return False
                raise
            except BaseException as exc:
                # only re-raise if it's *not* the exception that was
                # passed to throw(), because __exit__() must not raise
                # an exception unless __exit__() itself failed.  But throw()
                # has to raise the exception to signal propagation, so this
                # fixes the impedance mismatch between the throw() protocol
                # and the __exit__() protocol.
                if exc is not value:
                    raise
                return False
            raise RuntimeError("generator didn't stop after athrow()")


def asyncstartablecontext(
    func: Callable[..., AsyncIterator[_T_co]]
) -> Callable[..., GeneratorStartableContext[_T_co]]:
    """@asyncstartablecontext decorator.

    the decorated function can be called either as ``async with fn()``, **or**
    ``await fn()``.   This is decidedly different from what
    ``@contextlib.asynccontextmanager`` supports, and the usage pattern
    is different as well.

    Typical usage::

        @asyncstartablecontext
        async def some_async_generator(<arguments>):
            <setup>
            try:
                yield <value>
            except GeneratorExit:
                # return value was awaited, no context manager is present
                # and caller will .close() the resource explicitly
                pass
            else:
                <context manager cleanup>


    Above, ``GeneratorExit`` is caught if the function were used as an
    ``await``.  In this case, it's essential that the cleanup does **not**
    occur, so there should not be a ``finally`` block.

    If ``GeneratorExit`` is not invoked, this means we're in ``__aexit__``
    and we were invoked as a context manager, and cleanup should proceed.


    """

    @functools.wraps(func)
    def helper(*args: Any, **kwds: Any) -> GeneratorStartableContext[_T_co]:
        return GeneratorStartableContext(func, args, kwds)

    return helper


class ProxyComparable(ReversibleProxy[_PT]):
    __slots__ = ()

    @util.ro_non_memoized_property
    def _proxied(self) -> _PT:
        raise NotImplementedError()

    def __hash__(self) -> int:
        return id(self)

    def __eq__(self, other: Any) -> bool:
        return (
            isinstance(other, self.__class__)
            and self._proxied == other._proxied
        )

    def __ne__(self, other: Any) -> bool:
        return (
            not isinstance(other, self.__class__)
            or self._proxied != other._proxied
        )
