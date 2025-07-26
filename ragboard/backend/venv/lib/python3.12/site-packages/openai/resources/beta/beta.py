# File generated from our OpenAPI spec by Stainless.

from __future__ import annotations

from .threads import (
    Threads,
    AsyncThreads,
    ThreadsWithRawResponse,
    AsyncThreadsWithRawResponse,
    ThreadsWithStreamingResponse,
    AsyncThreadsWithStreamingResponse,
)
from ..._compat import cached_property
from .assistants import (
    Assistants,
    AsyncAssistants,
    AssistantsWithRawResponse,
    AsyncAssistantsWithRawResponse,
    AssistantsWithStreamingResponse,
    AsyncAssistantsWithStreamingResponse,
)
from ..._resource import SyncAPIResource, AsyncAPIResource
from .threads.threads import Threads, AsyncThreads
from .assistants.assistants import Assistants, AsyncAssistants

__all__ = ["Beta", "AsyncBeta"]


class Beta(SyncAPIResource):
    @cached_property
    def assistants(self) -> Assistants:
        return Assistants(self._client)

    @cached_property
    def threads(self) -> Threads:
        return Threads(self._client)

    @cached_property
    def with_raw_response(self) -> BetaWithRawResponse:
        return BetaWithRawResponse(self)

    @cached_property
    def with_streaming_response(self) -> BetaWithStreamingResponse:
        return BetaWithStreamingResponse(self)


class AsyncBeta(AsyncAPIResource):
    @cached_property
    def assistants(self) -> AsyncAssistants:
        return AsyncAssistants(self._client)

    @cached_property
    def threads(self) -> AsyncThreads:
        return AsyncThreads(self._client)

    @cached_property
    def with_raw_response(self) -> AsyncBetaWithRawResponse:
        return AsyncBetaWithRawResponse(self)

    @cached_property
    def with_streaming_response(self) -> AsyncBetaWithStreamingResponse:
        return AsyncBetaWithStreamingResponse(self)


class BetaWithRawResponse:
    def __init__(self, beta: Beta) -> None:
        self.assistants = AssistantsWithRawResponse(beta.assistants)
        self.threads = ThreadsWithRawResponse(beta.threads)


class AsyncBetaWithRawResponse:
    def __init__(self, beta: AsyncBeta) -> None:
        self.assistants = AsyncAssistantsWithRawResponse(beta.assistants)
        self.threads = AsyncThreadsWithRawResponse(beta.threads)


class BetaWithStreamingResponse:
    def __init__(self, beta: Beta) -> None:
        self.assistants = AssistantsWithStreamingResponse(beta.assistants)
        self.threads = ThreadsWithStreamingResponse(beta.threads)


class AsyncBetaWithStreamingResponse:
    def __init__(self, beta: AsyncBeta) -> None:
        self.assistants = AsyncAssistantsWithStreamingResponse(beta.assistants)
        self.threads = AsyncThreadsWithStreamingResponse(beta.threads)
