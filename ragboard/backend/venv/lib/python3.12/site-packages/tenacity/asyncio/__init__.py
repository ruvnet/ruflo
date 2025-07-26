# Copyright 2016 Étienne Bersac
# Copyright 2016 Julien Danjou
# Copyright 2016 Joshua Harlow
# Copyright 2013-2014 Ray Holder
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import functools
import sys
import typing as t

import tenacity
from tenacity import AttemptManager
from tenacity import BaseRetrying
from tenacity import DoAttempt
from tenacity import DoSleep
from tenacity import RetryCallState
from tenacity import RetryError
from tenacity import after_nothing
from tenacity import before_nothing
from tenacity import _utils

# Import all built-in retry strategies for easier usage.
from .retry import RetryBaseT
from .retry import retry_all  # noqa
from .retry import retry_any  # noqa
from .retry import retry_if_exception  # noqa
from .retry import retry_if_result  # noqa
from ..retry import RetryBaseT as SyncRetryBaseT

if t.TYPE_CHECKING:
    from tenacity.stop import StopBaseT
    from tenacity.wait import WaitBaseT

WrappedFnReturnT = t.TypeVar("WrappedFnReturnT")
WrappedFn = t.TypeVar("WrappedFn", bound=t.Callable[..., t.Awaitable[t.Any]])


def _portable_async_sleep(seconds: float) -> t.Awaitable[None]:
    # If trio is already imported, then importing it is cheap.
    # If trio isn't already imported, then it's definitely not running, so we
    # can skip further checks.
    if "trio" in sys.modules:
        # If trio is available, then sniffio is too
        import trio
        import sniffio

        if sniffio.current_async_library() == "trio":
            return trio.sleep(seconds)
    # Otherwise, assume asyncio
    # Lazy import asyncio as it's expensive (responsible for 25-50% of total import overhead).
    import asyncio

    return asyncio.sleep(seconds)


class AsyncRetrying(BaseRetrying):
    def __init__(
        self,
        sleep: t.Callable[
            [t.Union[int, float]], t.Union[None, t.Awaitable[None]]
        ] = _portable_async_sleep,
        stop: "StopBaseT" = tenacity.stop.stop_never,
        wait: "WaitBaseT" = tenacity.wait.wait_none(),
        retry: "t.Union[SyncRetryBaseT, RetryBaseT]" = tenacity.retry_if_exception_type(),
        before: t.Callable[
            ["RetryCallState"], t.Union[None, t.Awaitable[None]]
        ] = before_nothing,
        after: t.Callable[
            ["RetryCallState"], t.Union[None, t.Awaitable[None]]
        ] = after_nothing,
        before_sleep: t.Optional[
            t.Callable[["RetryCallState"], t.Union[None, t.Awaitable[None]]]
        ] = None,
        reraise: bool = False,
        retry_error_cls: t.Type["RetryError"] = RetryError,
        retry_error_callback: t.Optional[
            t.Callable[["RetryCallState"], t.Union[t.Any, t.Awaitable[t.Any]]]
        ] = None,
    ) -> None:
        super().__init__(
            sleep=sleep,  # type: ignore[arg-type]
            stop=stop,
            wait=wait,
            retry=retry,  # type: ignore[arg-type]
            before=before,  # type: ignore[arg-type]
            after=after,  # type: ignore[arg-type]
            before_sleep=before_sleep,  # type: ignore[arg-type]
            reraise=reraise,
            retry_error_cls=retry_error_cls,
            retry_error_callback=retry_error_callback,
        )

    async def __call__(  # type: ignore[override]
        self, fn: WrappedFn, *args: t.Any, **kwargs: t.Any
    ) -> WrappedFnReturnT:
        self.begin()

        retry_state = RetryCallState(retry_object=self, fn=fn, args=args, kwargs=kwargs)
        while True:
            do = await self.iter(retry_state=retry_state)
            if isinstance(do, DoAttempt):
                try:
                    result = await fn(*args, **kwargs)
                except BaseException:  # noqa: B902
                    retry_state.set_exception(sys.exc_info())  # type: ignore[arg-type]
                else:
                    retry_state.set_result(result)
            elif isinstance(do, DoSleep):
                retry_state.prepare_for_next_attempt()
                await self.sleep(do)  # type: ignore[misc]
            else:
                return do  # type: ignore[no-any-return]

    def _add_action_func(self, fn: t.Callable[..., t.Any]) -> None:
        self.iter_state.actions.append(_utils.wrap_to_async_func(fn))

    async def _run_retry(self, retry_state: "RetryCallState") -> None:  # type: ignore[override]
        self.iter_state.retry_run_result = await _utils.wrap_to_async_func(self.retry)(
            retry_state
        )

    async def _run_wait(self, retry_state: "RetryCallState") -> None:  # type: ignore[override]
        if self.wait:
            sleep = await _utils.wrap_to_async_func(self.wait)(retry_state)
        else:
            sleep = 0.0

        retry_state.upcoming_sleep = sleep

    async def _run_stop(self, retry_state: "RetryCallState") -> None:  # type: ignore[override]
        self.statistics["delay_since_first_attempt"] = retry_state.seconds_since_start
        self.iter_state.stop_run_result = await _utils.wrap_to_async_func(self.stop)(
            retry_state
        )

    async def iter(
        self, retry_state: "RetryCallState"
    ) -> t.Union[DoAttempt, DoSleep, t.Any]:  # noqa: A003
        self._begin_iter(retry_state)
        result = None
        for action in self.iter_state.actions:
            result = await action(retry_state)
        return result

    def __iter__(self) -> t.Generator[AttemptManager, None, None]:
        raise TypeError("AsyncRetrying object is not iterable")

    def __aiter__(self) -> "AsyncRetrying":
        self.begin()
        self._retry_state = RetryCallState(self, fn=None, args=(), kwargs={})
        return self

    async def __anext__(self) -> AttemptManager:
        while True:
            do = await self.iter(retry_state=self._retry_state)
            if do is None:
                raise StopAsyncIteration
            elif isinstance(do, DoAttempt):
                return AttemptManager(retry_state=self._retry_state)
            elif isinstance(do, DoSleep):
                self._retry_state.prepare_for_next_attempt()
                await self.sleep(do)  # type: ignore[misc]
            else:
                raise StopAsyncIteration

    def wraps(self, fn: WrappedFn) -> WrappedFn:
        wrapped = super().wraps(fn)
        # Ensure wrapper is recognized as a coroutine function.

        @functools.wraps(
            fn, functools.WRAPPER_ASSIGNMENTS + ("__defaults__", "__kwdefaults__")
        )
        async def async_wrapped(*args: t.Any, **kwargs: t.Any) -> t.Any:
            # Always create a copy to prevent overwriting the local contexts when
            # calling the same wrapped functions multiple times in the same stack
            copy = self.copy()
            async_wrapped.statistics = copy.statistics  # type: ignore[attr-defined]
            return await copy(fn, *args, **kwargs)

        # Preserve attributes
        async_wrapped.retry = self  # type: ignore[attr-defined]
        async_wrapped.retry_with = wrapped.retry_with  # type: ignore[attr-defined]
        async_wrapped.statistics = {}  # type: ignore[attr-defined]

        return async_wrapped  # type: ignore[return-value]


__all__ = [
    "retry_all",
    "retry_any",
    "retry_if_exception",
    "retry_if_result",
    "WrappedFn",
    "AsyncRetrying",
]
