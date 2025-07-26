# File generated from our OpenAPI spec by Stainless.

from __future__ import annotations

from typing import TYPE_CHECKING

from .messages import (
    Messages,
    AsyncMessages,
    MessagesWithRawResponse,
    AsyncMessagesWithRawResponse,
)
from ..._resource import SyncAPIResource, AsyncAPIResource

if TYPE_CHECKING:
    from ..._client import Anthropic, AsyncAnthropic

__all__ = ["Beta", "AsyncBeta"]


class Beta(SyncAPIResource):
    messages: Messages
    with_raw_response: BetaWithRawResponse

    def __init__(self, client: Anthropic) -> None:
        super().__init__(client)
        self.messages = Messages(client)
        self.with_raw_response = BetaWithRawResponse(self)


class AsyncBeta(AsyncAPIResource):
    messages: AsyncMessages
    with_raw_response: AsyncBetaWithRawResponse

    def __init__(self, client: AsyncAnthropic) -> None:
        super().__init__(client)
        self.messages = AsyncMessages(client)
        self.with_raw_response = AsyncBetaWithRawResponse(self)


class BetaWithRawResponse:
    def __init__(self, beta: Beta) -> None:
        self.messages = MessagesWithRawResponse(beta.messages)


class AsyncBetaWithRawResponse:
    def __init__(self, beta: AsyncBeta) -> None:
        self.messages = AsyncMessagesWithRawResponse(beta.messages)
