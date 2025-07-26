# File generated from our OpenAPI spec by Stainless.

from __future__ import annotations

from typing import List, Optional

import httpx

from .... import _legacy_response
from .runs import (
    Runs,
    AsyncRuns,
    RunsWithRawResponse,
    AsyncRunsWithRawResponse,
    RunsWithStreamingResponse,
    AsyncRunsWithStreamingResponse,
)
from .messages import (
    Messages,
    AsyncMessages,
    MessagesWithRawResponse,
    AsyncMessagesWithRawResponse,
    MessagesWithStreamingResponse,
    AsyncMessagesWithStreamingResponse,
)
from ...._types import NOT_GIVEN, Body, Query, Headers, NotGiven
from ...._utils import maybe_transform
from .runs.runs import Runs, AsyncRuns
from ...._compat import cached_property
from ...._resource import SyncAPIResource, AsyncAPIResource
from ...._response import to_streamed_response_wrapper, async_to_streamed_response_wrapper
from ....types.beta import (
    Thread,
    ThreadDeleted,
    thread_create_params,
    thread_update_params,
    thread_create_and_run_params,
)
from ...._base_client import (
    make_request_options,
)
from .messages.messages import Messages, AsyncMessages
from ....types.beta.threads import Run

__all__ = ["Threads", "AsyncThreads"]


class Threads(SyncAPIResource):
    @cached_property
    def runs(self) -> Runs:
        return Runs(self._client)

    @cached_property
    def messages(self) -> Messages:
        return Messages(self._client)

    @cached_property
    def with_raw_response(self) -> ThreadsWithRawResponse:
        return ThreadsWithRawResponse(self)

    @cached_property
    def with_streaming_response(self) -> ThreadsWithStreamingResponse:
        return ThreadsWithStreamingResponse(self)

    def create(
        self,
        *,
        messages: List[thread_create_params.Message] | NotGiven = NOT_GIVEN,
        metadata: Optional[object] | NotGiven = NOT_GIVEN,
        # Use the following arguments if you need to pass additional parameters to the API that aren't available via kwargs.
        # The extra values given here take precedence over values defined on the client or passed to this method.
        extra_headers: Headers | None = None,
        extra_query: Query | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> Thread:
        """
        Create a thread.

        Args:
          messages: A list of [messages](https://platform.openai.com/docs/api-reference/messages) to
              start the thread with.

          metadata: Set of 16 key-value pairs that can be attached to an object. This can be useful
              for storing additional information about the object in a structured format. Keys
              can be a maximum of 64 characters long and values can be a maxium of 512
              characters long.

          extra_headers: Send extra headers

          extra_query: Add additional query parameters to the request

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        extra_headers = {"OpenAI-Beta": "assistants=v1", **(extra_headers or {})}
        return self._post(
            "/threads",
            body=maybe_transform(
                {
                    "messages": messages,
                    "metadata": metadata,
                },
                thread_create_params.ThreadCreateParams,
            ),
            options=make_request_options(
                extra_headers=extra_headers, extra_query=extra_query, extra_body=extra_body, timeout=timeout
            ),
            cast_to=Thread,
        )

    def retrieve(
        self,
        thread_id: str,
        *,
        # Use the following arguments if you need to pass additional parameters to the API that aren't available via kwargs.
        # The extra values given here take precedence over values defined on the client or passed to this method.
        extra_headers: Headers | None = None,
        extra_query: Query | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> Thread:
        """
        Retrieves a thread.

        Args:
          extra_headers: Send extra headers

          extra_query: Add additional query parameters to the request

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        if not thread_id:
            raise ValueError(f"Expected a non-empty value for `thread_id` but received {thread_id!r}")
        extra_headers = {"OpenAI-Beta": "assistants=v1", **(extra_headers or {})}
        return self._get(
            f"/threads/{thread_id}",
            options=make_request_options(
                extra_headers=extra_headers, extra_query=extra_query, extra_body=extra_body, timeout=timeout
            ),
            cast_to=Thread,
        )

    def update(
        self,
        thread_id: str,
        *,
        metadata: Optional[object] | NotGiven = NOT_GIVEN,
        # Use the following arguments if you need to pass additional parameters to the API that aren't available via kwargs.
        # The extra values given here take precedence over values defined on the client or passed to this method.
        extra_headers: Headers | None = None,
        extra_query: Query | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> Thread:
        """
        Modifies a thread.

        Args:
          metadata: Set of 16 key-value pairs that can be attached to an object. This can be useful
              for storing additional information about the object in a structured format. Keys
              can be a maximum of 64 characters long and values can be a maxium of 512
              characters long.

          extra_headers: Send extra headers

          extra_query: Add additional query parameters to the request

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        if not thread_id:
            raise ValueError(f"Expected a non-empty value for `thread_id` but received {thread_id!r}")
        extra_headers = {"OpenAI-Beta": "assistants=v1", **(extra_headers or {})}
        return self._post(
            f"/threads/{thread_id}",
            body=maybe_transform({"metadata": metadata}, thread_update_params.ThreadUpdateParams),
            options=make_request_options(
                extra_headers=extra_headers, extra_query=extra_query, extra_body=extra_body, timeout=timeout
            ),
            cast_to=Thread,
        )

    def delete(
        self,
        thread_id: str,
        *,
        # Use the following arguments if you need to pass additional parameters to the API that aren't available via kwargs.
        # The extra values given here take precedence over values defined on the client or passed to this method.
        extra_headers: Headers | None = None,
        extra_query: Query | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> ThreadDeleted:
        """
        Delete a thread.

        Args:
          extra_headers: Send extra headers

          extra_query: Add additional query parameters to the request

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        if not thread_id:
            raise ValueError(f"Expected a non-empty value for `thread_id` but received {thread_id!r}")
        extra_headers = {"OpenAI-Beta": "assistants=v1", **(extra_headers or {})}
        return self._delete(
            f"/threads/{thread_id}",
            options=make_request_options(
                extra_headers=extra_headers, extra_query=extra_query, extra_body=extra_body, timeout=timeout
            ),
            cast_to=ThreadDeleted,
        )

    def create_and_run(
        self,
        *,
        assistant_id: str,
        instructions: Optional[str] | NotGiven = NOT_GIVEN,
        metadata: Optional[object] | NotGiven = NOT_GIVEN,
        model: Optional[str] | NotGiven = NOT_GIVEN,
        thread: thread_create_and_run_params.Thread | NotGiven = NOT_GIVEN,
        tools: Optional[List[thread_create_and_run_params.Tool]] | NotGiven = NOT_GIVEN,
        # Use the following arguments if you need to pass additional parameters to the API that aren't available via kwargs.
        # The extra values given here take precedence over values defined on the client or passed to this method.
        extra_headers: Headers | None = None,
        extra_query: Query | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> Run:
        """
        Create a thread and run it in one request.

        Args:
          assistant_id: The ID of the
              [assistant](https://platform.openai.com/docs/api-reference/assistants) to use to
              execute this run.

          instructions: Override the default system message of the assistant. This is useful for
              modifying the behavior on a per-run basis.

          metadata: Set of 16 key-value pairs that can be attached to an object. This can be useful
              for storing additional information about the object in a structured format. Keys
              can be a maximum of 64 characters long and values can be a maxium of 512
              characters long.

          model: The ID of the [Model](https://platform.openai.com/docs/api-reference/models) to
              be used to execute this run. If a value is provided here, it will override the
              model associated with the assistant. If not, the model associated with the
              assistant will be used.

          thread: If no thread is provided, an empty thread will be created.

          tools: Override the tools the assistant can use for this run. This is useful for
              modifying the behavior on a per-run basis.

          extra_headers: Send extra headers

          extra_query: Add additional query parameters to the request

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        extra_headers = {"OpenAI-Beta": "assistants=v1", **(extra_headers or {})}
        return self._post(
            "/threads/runs",
            body=maybe_transform(
                {
                    "assistant_id": assistant_id,
                    "instructions": instructions,
                    "metadata": metadata,
                    "model": model,
                    "thread": thread,
                    "tools": tools,
                },
                thread_create_and_run_params.ThreadCreateAndRunParams,
            ),
            options=make_request_options(
                extra_headers=extra_headers, extra_query=extra_query, extra_body=extra_body, timeout=timeout
            ),
            cast_to=Run,
        )


class AsyncThreads(AsyncAPIResource):
    @cached_property
    def runs(self) -> AsyncRuns:
        return AsyncRuns(self._client)

    @cached_property
    def messages(self) -> AsyncMessages:
        return AsyncMessages(self._client)

    @cached_property
    def with_raw_response(self) -> AsyncThreadsWithRawResponse:
        return AsyncThreadsWithRawResponse(self)

    @cached_property
    def with_streaming_response(self) -> AsyncThreadsWithStreamingResponse:
        return AsyncThreadsWithStreamingResponse(self)

    async def create(
        self,
        *,
        messages: List[thread_create_params.Message] | NotGiven = NOT_GIVEN,
        metadata: Optional[object] | NotGiven = NOT_GIVEN,
        # Use the following arguments if you need to pass additional parameters to the API that aren't available via kwargs.
        # The extra values given here take precedence over values defined on the client or passed to this method.
        extra_headers: Headers | None = None,
        extra_query: Query | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> Thread:
        """
        Create a thread.

        Args:
          messages: A list of [messages](https://platform.openai.com/docs/api-reference/messages) to
              start the thread with.

          metadata: Set of 16 key-value pairs that can be attached to an object. This can be useful
              for storing additional information about the object in a structured format. Keys
              can be a maximum of 64 characters long and values can be a maxium of 512
              characters long.

          extra_headers: Send extra headers

          extra_query: Add additional query parameters to the request

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        extra_headers = {"OpenAI-Beta": "assistants=v1", **(extra_headers or {})}
        return await self._post(
            "/threads",
            body=maybe_transform(
                {
                    "messages": messages,
                    "metadata": metadata,
                },
                thread_create_params.ThreadCreateParams,
            ),
            options=make_request_options(
                extra_headers=extra_headers, extra_query=extra_query, extra_body=extra_body, timeout=timeout
            ),
            cast_to=Thread,
        )

    async def retrieve(
        self,
        thread_id: str,
        *,
        # Use the following arguments if you need to pass additional parameters to the API that aren't available via kwargs.
        # The extra values given here take precedence over values defined on the client or passed to this method.
        extra_headers: Headers | None = None,
        extra_query: Query | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> Thread:
        """
        Retrieves a thread.

        Args:
          extra_headers: Send extra headers

          extra_query: Add additional query parameters to the request

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        if not thread_id:
            raise ValueError(f"Expected a non-empty value for `thread_id` but received {thread_id!r}")
        extra_headers = {"OpenAI-Beta": "assistants=v1", **(extra_headers or {})}
        return await self._get(
            f"/threads/{thread_id}",
            options=make_request_options(
                extra_headers=extra_headers, extra_query=extra_query, extra_body=extra_body, timeout=timeout
            ),
            cast_to=Thread,
        )

    async def update(
        self,
        thread_id: str,
        *,
        metadata: Optional[object] | NotGiven = NOT_GIVEN,
        # Use the following arguments if you need to pass additional parameters to the API that aren't available via kwargs.
        # The extra values given here take precedence over values defined on the client or passed to this method.
        extra_headers: Headers | None = None,
        extra_query: Query | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> Thread:
        """
        Modifies a thread.

        Args:
          metadata: Set of 16 key-value pairs that can be attached to an object. This can be useful
              for storing additional information about the object in a structured format. Keys
              can be a maximum of 64 characters long and values can be a maxium of 512
              characters long.

          extra_headers: Send extra headers

          extra_query: Add additional query parameters to the request

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        if not thread_id:
            raise ValueError(f"Expected a non-empty value for `thread_id` but received {thread_id!r}")
        extra_headers = {"OpenAI-Beta": "assistants=v1", **(extra_headers or {})}
        return await self._post(
            f"/threads/{thread_id}",
            body=maybe_transform({"metadata": metadata}, thread_update_params.ThreadUpdateParams),
            options=make_request_options(
                extra_headers=extra_headers, extra_query=extra_query, extra_body=extra_body, timeout=timeout
            ),
            cast_to=Thread,
        )

    async def delete(
        self,
        thread_id: str,
        *,
        # Use the following arguments if you need to pass additional parameters to the API that aren't available via kwargs.
        # The extra values given here take precedence over values defined on the client or passed to this method.
        extra_headers: Headers | None = None,
        extra_query: Query | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> ThreadDeleted:
        """
        Delete a thread.

        Args:
          extra_headers: Send extra headers

          extra_query: Add additional query parameters to the request

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        if not thread_id:
            raise ValueError(f"Expected a non-empty value for `thread_id` but received {thread_id!r}")
        extra_headers = {"OpenAI-Beta": "assistants=v1", **(extra_headers or {})}
        return await self._delete(
            f"/threads/{thread_id}",
            options=make_request_options(
                extra_headers=extra_headers, extra_query=extra_query, extra_body=extra_body, timeout=timeout
            ),
            cast_to=ThreadDeleted,
        )

    async def create_and_run(
        self,
        *,
        assistant_id: str,
        instructions: Optional[str] | NotGiven = NOT_GIVEN,
        metadata: Optional[object] | NotGiven = NOT_GIVEN,
        model: Optional[str] | NotGiven = NOT_GIVEN,
        thread: thread_create_and_run_params.Thread | NotGiven = NOT_GIVEN,
        tools: Optional[List[thread_create_and_run_params.Tool]] | NotGiven = NOT_GIVEN,
        # Use the following arguments if you need to pass additional parameters to the API that aren't available via kwargs.
        # The extra values given here take precedence over values defined on the client or passed to this method.
        extra_headers: Headers | None = None,
        extra_query: Query | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> Run:
        """
        Create a thread and run it in one request.

        Args:
          assistant_id: The ID of the
              [assistant](https://platform.openai.com/docs/api-reference/assistants) to use to
              execute this run.

          instructions: Override the default system message of the assistant. This is useful for
              modifying the behavior on a per-run basis.

          metadata: Set of 16 key-value pairs that can be attached to an object. This can be useful
              for storing additional information about the object in a structured format. Keys
              can be a maximum of 64 characters long and values can be a maxium of 512
              characters long.

          model: The ID of the [Model](https://platform.openai.com/docs/api-reference/models) to
              be used to execute this run. If a value is provided here, it will override the
              model associated with the assistant. If not, the model associated with the
              assistant will be used.

          thread: If no thread is provided, an empty thread will be created.

          tools: Override the tools the assistant can use for this run. This is useful for
              modifying the behavior on a per-run basis.

          extra_headers: Send extra headers

          extra_query: Add additional query parameters to the request

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        extra_headers = {"OpenAI-Beta": "assistants=v1", **(extra_headers or {})}
        return await self._post(
            "/threads/runs",
            body=maybe_transform(
                {
                    "assistant_id": assistant_id,
                    "instructions": instructions,
                    "metadata": metadata,
                    "model": model,
                    "thread": thread,
                    "tools": tools,
                },
                thread_create_and_run_params.ThreadCreateAndRunParams,
            ),
            options=make_request_options(
                extra_headers=extra_headers, extra_query=extra_query, extra_body=extra_body, timeout=timeout
            ),
            cast_to=Run,
        )


class ThreadsWithRawResponse:
    def __init__(self, threads: Threads) -> None:
        self.runs = RunsWithRawResponse(threads.runs)
        self.messages = MessagesWithRawResponse(threads.messages)

        self.create = _legacy_response.to_raw_response_wrapper(
            threads.create,
        )
        self.retrieve = _legacy_response.to_raw_response_wrapper(
            threads.retrieve,
        )
        self.update = _legacy_response.to_raw_response_wrapper(
            threads.update,
        )
        self.delete = _legacy_response.to_raw_response_wrapper(
            threads.delete,
        )
        self.create_and_run = _legacy_response.to_raw_response_wrapper(
            threads.create_and_run,
        )


class AsyncThreadsWithRawResponse:
    def __init__(self, threads: AsyncThreads) -> None:
        self.runs = AsyncRunsWithRawResponse(threads.runs)
        self.messages = AsyncMessagesWithRawResponse(threads.messages)

        self.create = _legacy_response.async_to_raw_response_wrapper(
            threads.create,
        )
        self.retrieve = _legacy_response.async_to_raw_response_wrapper(
            threads.retrieve,
        )
        self.update = _legacy_response.async_to_raw_response_wrapper(
            threads.update,
        )
        self.delete = _legacy_response.async_to_raw_response_wrapper(
            threads.delete,
        )
        self.create_and_run = _legacy_response.async_to_raw_response_wrapper(
            threads.create_and_run,
        )


class ThreadsWithStreamingResponse:
    def __init__(self, threads: Threads) -> None:
        self.runs = RunsWithStreamingResponse(threads.runs)
        self.messages = MessagesWithStreamingResponse(threads.messages)

        self.create = to_streamed_response_wrapper(
            threads.create,
        )
        self.retrieve = to_streamed_response_wrapper(
            threads.retrieve,
        )
        self.update = to_streamed_response_wrapper(
            threads.update,
        )
        self.delete = to_streamed_response_wrapper(
            threads.delete,
        )
        self.create_and_run = to_streamed_response_wrapper(
            threads.create_and_run,
        )


class AsyncThreadsWithStreamingResponse:
    def __init__(self, threads: AsyncThreads) -> None:
        self.runs = AsyncRunsWithStreamingResponse(threads.runs)
        self.messages = AsyncMessagesWithStreamingResponse(threads.messages)

        self.create = async_to_streamed_response_wrapper(
            threads.create,
        )
        self.retrieve = async_to_streamed_response_wrapper(
            threads.retrieve,
        )
        self.update = async_to_streamed_response_wrapper(
            threads.update,
        )
        self.delete = async_to_streamed_response_wrapper(
            threads.delete,
        )
        self.create_and_run = async_to_streamed_response_wrapper(
            threads.create_and_run,
        )
