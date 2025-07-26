# Copyright 2016–2021 Julien Danjou
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
import abc
import typing

from tenacity import _utils
from tenacity import retry_base

if typing.TYPE_CHECKING:
    from tenacity import RetryCallState


class async_retry_base(retry_base):
    """Abstract base class for async retry strategies."""

    @abc.abstractmethod
    async def __call__(self, retry_state: "RetryCallState") -> bool:  # type: ignore[override]
        pass

    def __and__(  # type: ignore[override]
        self, other: "typing.Union[retry_base, async_retry_base]"
    ) -> "retry_all":
        return retry_all(self, other)

    def __rand__(  # type: ignore[misc,override]
        self, other: "typing.Union[retry_base, async_retry_base]"
    ) -> "retry_all":
        return retry_all(other, self)

    def __or__(  # type: ignore[override]
        self, other: "typing.Union[retry_base, async_retry_base]"
    ) -> "retry_any":
        return retry_any(self, other)

    def __ror__(  # type: ignore[misc,override]
        self, other: "typing.Union[retry_base, async_retry_base]"
    ) -> "retry_any":
        return retry_any(other, self)


RetryBaseT = typing.Union[
    async_retry_base, typing.Callable[["RetryCallState"], typing.Awaitable[bool]]
]


class retry_if_exception(async_retry_base):
    """Retry strategy that retries if an exception verifies a predicate."""

    def __init__(
        self, predicate: typing.Callable[[BaseException], typing.Awaitable[bool]]
    ) -> None:
        self.predicate = predicate

    async def __call__(self, retry_state: "RetryCallState") -> bool:  # type: ignore[override]
        if retry_state.outcome is None:
            raise RuntimeError("__call__() called before outcome was set")

        if retry_state.outcome.failed:
            exception = retry_state.outcome.exception()
            if exception is None:
                raise RuntimeError("outcome failed but the exception is None")
            return await self.predicate(exception)
        else:
            return False


class retry_if_result(async_retry_base):
    """Retries if the result verifies a predicate."""

    def __init__(
        self, predicate: typing.Callable[[typing.Any], typing.Awaitable[bool]]
    ) -> None:
        self.predicate = predicate

    async def __call__(self, retry_state: "RetryCallState") -> bool:  # type: ignore[override]
        if retry_state.outcome is None:
            raise RuntimeError("__call__() called before outcome was set")

        if not retry_state.outcome.failed:
            return await self.predicate(retry_state.outcome.result())
        else:
            return False


class retry_any(async_retry_base):
    """Retries if any of the retries condition is valid."""

    def __init__(self, *retries: typing.Union[retry_base, async_retry_base]) -> None:
        self.retries = retries

    async def __call__(self, retry_state: "RetryCallState") -> bool:  # type: ignore[override]
        result = False
        for r in self.retries:
            result = result or await _utils.wrap_to_async_func(r)(retry_state)
            if result:
                break
        return result


class retry_all(async_retry_base):
    """Retries if all the retries condition are valid."""

    def __init__(self, *retries: typing.Union[retry_base, async_retry_base]) -> None:
        self.retries = retries

    async def __call__(self, retry_state: "RetryCallState") -> bool:  # type: ignore[override]
        result = True
        for r in self.retries:
            result = result and await _utils.wrap_to_async_func(r)(retry_state)
            if not result:
                break
        return result
