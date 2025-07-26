# File generated from our OpenAPI spec by Stainless.

from __future__ import annotations

from ..._compat import cached_property
from ..._resource import SyncAPIResource, AsyncAPIResource
from .completions import (
    Completions,
    AsyncCompletions,
    CompletionsWithRawResponse,
    AsyncCompletionsWithRawResponse,
    CompletionsWithStreamingResponse,
    AsyncCompletionsWithStreamingResponse,
)

__all__ = ["Chat", "AsyncChat"]


class Chat(SyncAPIResource):
    @cached_property
    def completions(self) -> Completions:
        return Completions(self._client)

    @cached_property
    def with_raw_response(self) -> ChatWithRawResponse:
        return ChatWithRawResponse(self)

    @cached_property
    def with_streaming_response(self) -> ChatWithStreamingResponse:
        return ChatWithStreamingResponse(self)


class AsyncChat(AsyncAPIResource):
    @cached_property
    def completions(self) -> AsyncCompletions:
        return AsyncCompletions(self._client)

    @cached_property
    def with_raw_response(self) -> AsyncChatWithRawResponse:
        return AsyncChatWithRawResponse(self)

    @cached_property
    def with_streaming_response(self) -> AsyncChatWithStreamingResponse:
        return AsyncChatWithStreamingResponse(self)


class ChatWithRawResponse:
    def __init__(self, chat: Chat) -> None:
        self.completions = CompletionsWithRawResponse(chat.completions)


class AsyncChatWithRawResponse:
    def __init__(self, chat: AsyncChat) -> None:
        self.completions = AsyncCompletionsWithRawResponse(chat.completions)


class ChatWithStreamingResponse:
    def __init__(self, chat: Chat) -> None:
        self.completions = CompletionsWithStreamingResponse(chat.completions)


class AsyncChatWithStreamingResponse:
    def __init__(self, chat: AsyncChat) -> None:
        self.completions = AsyncCompletionsWithStreamingResponse(chat.completions)
