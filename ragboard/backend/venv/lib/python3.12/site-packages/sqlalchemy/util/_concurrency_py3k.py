# util/_concurrency_py3k.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: allow-untyped-defs, allow-untyped-calls

from __future__ import annotations

import asyncio
from contextvars import Context
import sys
import typing
from typing import Any
from typing import Awaitable
from typing import Callable
from typing import Coroutine
from typing import Optional
from typing import TYPE_CHECKING
from typing import TypeVar

from .langhelpers import memoized_property
from .. import exc
from ..util.typing import Protocol
from ..util.typing import TypeGuard

_T = TypeVar("_T")

if typing.TYPE_CHECKING:

    class greenlet(Protocol):
        dead: bool
        gr_context: Optional[Context]

        def __init__(self, fn: Callable[..., Any], driver: greenlet):
            ...

        def throw(self, *arg: Any) -> Any:
            return None

        def switch(self, value: Any) -> Any:
            return None

    def getcurrent() -> greenlet:
        ...

else:
    from greenlet import getcurrent
    from greenlet import greenlet


# If greenlet.gr_context is present in current version of greenlet,
# it will be set with the current context on creation.
# Refs: https://github.com/python-greenlet/greenlet/pull/198
_has_gr_context = hasattr(getcurrent(), "gr_context")


def is_exit_exception(e: BaseException) -> bool:
    # note asyncio.CancelledError is already BaseException
    # so was an exit exception in any case
    return not isinstance(e, Exception) or isinstance(
        e, (asyncio.TimeoutError, asyncio.CancelledError)
    )


# implementation based on snaury gist at
# https://gist.github.com/snaury/202bf4f22c41ca34e56297bae5f33fef
# Issue for context: https://github.com/python-greenlet/greenlet/issues/173


class _AsyncIoGreenlet(greenlet):
    dead: bool

    def __init__(self, fn: Callable[..., Any], driver: greenlet):
        greenlet.__init__(self, fn, driver)
        self.driver = driver
        if _has_gr_context:
            self.gr_context = driver.gr_context


_T_co = TypeVar("_T_co", covariant=True)

if TYPE_CHECKING:

    def iscoroutine(
        awaitable: Awaitable[_T_co],
    ) -> TypeGuard[Coroutine[Any, Any, _T_co]]:
        ...

else:
    iscoroutine = asyncio.iscoroutine


def _safe_cancel_awaitable(awaitable: Awaitable[Any]) -> None:
    # https://docs.python.org/3/reference/datamodel.html#coroutine.close

    if iscoroutine(awaitable):
        awaitable.close()


def in_greenlet() -> bool:
    current = getcurrent()
    return isinstance(current, _AsyncIoGreenlet)


def await_only(awaitable: Awaitable[_T]) -> _T:
    """Awaits an async function in a sync method.

    The sync method must be inside a :func:`greenlet_spawn` context.
    :func:`await_only` calls cannot be nested.

    :param awaitable: The coroutine to call.

    """
    # this is called in the context greenlet while running fn
    current = getcurrent()
    if not isinstance(current, _AsyncIoGreenlet):
        _safe_cancel_awaitable(awaitable)

        raise exc.MissingGreenlet(
            "greenlet_spawn has not been called; can't call await_only() "
            "here. Was IO attempted in an unexpected place?"
        )

    # returns the control to the driver greenlet passing it
    # a coroutine to run. Once the awaitable is done, the driver greenlet
    # switches back to this greenlet with the result of awaitable that is
    # then returned to the caller (or raised as error)
    return current.driver.switch(awaitable)  # type: ignore[no-any-return]


def await_fallback(awaitable: Awaitable[_T]) -> _T:
    """Awaits an async function in a sync method.

    The sync method must be inside a :func:`greenlet_spawn` context.
    :func:`await_fallback` calls cannot be nested.

    :param awaitable: The coroutine to call.

    .. deprecated:: 2.0.24 The ``await_fallback()`` function will be removed
       in SQLAlchemy 2.1.  Use :func:`_util.await_only` instead, running the
       function / program / etc. within a top-level greenlet that is set up
       using :func:`_util.greenlet_spawn`.

    """

    # this is called in the context greenlet while running fn
    current = getcurrent()
    if not isinstance(current, _AsyncIoGreenlet):
        loop = get_event_loop()
        if loop.is_running():
            _safe_cancel_awaitable(awaitable)

            raise exc.MissingGreenlet(
                "greenlet_spawn has not been called and asyncio event "
                "loop is already running; can't call await_fallback() here. "
                "Was IO attempted in an unexpected place?"
            )
        return loop.run_until_complete(awaitable)

    return current.driver.switch(awaitable)  # type: ignore[no-any-return]


async def greenlet_spawn(
    fn: Callable[..., _T],
    *args: Any,
    _require_await: bool = False,
    **kwargs: Any,
) -> _T:
    """Runs a sync function ``fn`` in a new greenlet.

    The sync function can then use :func:`await_only` to wait for async
    functions.

    :param fn: The sync callable to call.
    :param \\*args: Positional arguments to pass to the ``fn`` callable.
    :param \\*\\*kwargs: Keyword arguments to pass to the ``fn`` callable.
    """

    result: Any
    context = _AsyncIoGreenlet(fn, getcurrent())
    # runs the function synchronously in gl greenlet. If the execution
    # is interrupted by await_only, context is not dead and result is a
    # coroutine to wait. If the context is dead the function has
    # returned, and its result can be returned.
    switch_occurred = False
    try:
        result = context.switch(*args, **kwargs)
        while not context.dead:
            switch_occurred = True
            try:
                # wait for a coroutine from await_only and then return its
                # result back to it.
                value = await result
            except BaseException:
                # this allows an exception to be raised within
                # the moderated greenlet so that it can continue
                # its expected flow.
                result = context.throw(*sys.exc_info())
            else:
                result = context.switch(value)
    finally:
        # clean up to avoid cycle resolution by gc
        del context.driver
    if _require_await and not switch_occurred:
        raise exc.AwaitRequired(
            "The current operation required an async execution but none was "
            "detected. This will usually happen when using a non compatible "
            "DBAPI driver. Please ensure that an async DBAPI is used."
        )
    return result  # type: ignore[no-any-return]


class AsyncAdaptedLock:
    @memoized_property
    def mutex(self) -> asyncio.Lock:
        # there should not be a race here for coroutines creating the
        # new lock as we are not using await, so therefore no concurrency
        return asyncio.Lock()

    def __enter__(self) -> bool:
        # await is used to acquire the lock only after the first calling
        # coroutine has created the mutex.
        return await_fallback(self.mutex.acquire())

    def __exit__(self, *arg: Any, **kw: Any) -> None:
        self.mutex.release()


def _util_async_run_coroutine_function(
    fn: Callable[..., Coroutine[Any, Any, Any]], *args: Any, **kwargs: Any
) -> Any:
    """for test suite/ util only"""

    loop = get_event_loop()
    if loop.is_running():
        raise Exception(
            "for async run coroutine we expect that no greenlet or event "
            "loop is running when we start out"
        )
    return loop.run_until_complete(fn(*args, **kwargs))


def _util_async_run(
    fn: Callable[..., Coroutine[Any, Any, Any]], *args: Any, **kwargs: Any
) -> Any:
    """for test suite/ util only"""

    loop = get_event_loop()
    if not loop.is_running():
        return loop.run_until_complete(greenlet_spawn(fn, *args, **kwargs))
    else:
        # allow for a wrapped test function to call another
        assert isinstance(getcurrent(), _AsyncIoGreenlet)
        return fn(*args, **kwargs)


def get_event_loop() -> asyncio.AbstractEventLoop:
    """vendor asyncio.get_event_loop() for python 3.7 and above.

    Python 3.10 deprecates get_event_loop() as a standalone.

    """
    try:
        return asyncio.get_running_loop()
    except RuntimeError:
        # avoid "During handling of the above exception, another exception..."
        pass
    return asyncio.get_event_loop_policy().get_event_loop()
