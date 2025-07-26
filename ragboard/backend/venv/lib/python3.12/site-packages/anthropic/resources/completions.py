# File generated from our OpenAPI spec by Stainless.

from __future__ import annotations

from typing import TYPE_CHECKING, List, Union, overload
from typing_extensions import Literal

import httpx

from ..types import Completion, completion_create_params
from .._types import NOT_GIVEN, Body, Query, Headers, NotGiven
from .._utils import required_args, maybe_transform
from .._resource import SyncAPIResource, AsyncAPIResource
from .._response import to_raw_response_wrapper, async_to_raw_response_wrapper
from .._streaming import Stream, AsyncStream
from .._base_client import make_request_options

if TYPE_CHECKING:
    from .._client import Anthropic, AsyncAnthropic

__all__ = ["Completions", "AsyncCompletions"]


class Completions(SyncAPIResource):
    with_raw_response: CompletionsWithRawResponse

    def __init__(self, client: Anthropic) -> None:
        super().__init__(client)
        self.with_raw_response = CompletionsWithRawResponse(self)

    @overload
    def create(
        self,
        *,
        max_tokens_to_sample: int,
        model: Union[str, Literal["claude-2.1", "claude-instant-1"]],
        prompt: str,
        metadata: completion_create_params.Metadata | NotGiven = NOT_GIVEN,
        stop_sequences: List[str] | NotGiven = NOT_GIVEN,
        stream: Literal[False] | NotGiven = NOT_GIVEN,
        temperature: float | NotGiven = NOT_GIVEN,
        top_k: int | NotGiven = NOT_GIVEN,
        top_p: float | NotGiven = NOT_GIVEN,
        # Use the following arguments if you need to pass additional parameters to the API that aren't available via kwargs.
        # The extra values given here take precedence over values defined on the client or passed to this method.
        extra_headers: Headers | None = None,
        extra_query: Query | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = 600,
    ) -> Completion:
        """
        Create a Completion

        Args:
          max_tokens_to_sample: The maximum number of tokens to generate before stopping.

              Note that our models may stop _before_ reaching this maximum. This parameter
              only specifies the absolute maximum number of tokens to generate.

          model: The model that will complete your prompt.

              As we improve Claude, we develop new versions of it that you can query. The
              `model` parameter controls which version of Claude responds to your request.
              Right now we offer two model families: Claude, and Claude Instant. You can use
              them by setting `model` to `"claude-2.1"` or `"claude-instant-1.2"`,
              respectively.

              See [models](https://docs.anthropic.com/claude/reference/selecting-a-model) for
              additional details and options.

          prompt: The prompt that you want Claude to complete.

              For proper response generation you will need to format your prompt using
              alternating `\n\nHuman:` and `\n\nAssistant:` conversational turns. For example:

              ```
              "\n\nHuman: {userQuestion}\n\nAssistant:"
              ```

              See
              [prompt validation](https://anthropic.readme.io/claude/reference/prompt-validation)
              and our guide to
              [prompt design](https://docs.anthropic.com/claude/docs/introduction-to-prompt-design)
              for more details.

          metadata: An object describing metadata about the request.

          stop_sequences: Sequences that will cause the model to stop generating.

              Our models stop on `"\n\nHuman:"`, and may include additional built-in stop
              sequences in the future. By providing the stop_sequences parameter, you may
              include additional strings that will cause the model to stop generating.

          stream: Whether to incrementally stream the response using server-sent events.

              See [streaming](https://docs.anthropic.com/claude/reference/streaming) for
              details.

          temperature: Amount of randomness injected into the response.

              Defaults to 1. Ranges from 0 to 1. Use temp closer to 0 for analytical /
              multiple choice, and closer to 1 for creative and generative tasks.

          top_k: Only sample from the top K options for each subsequent token.

              Used to remove "long tail" low probability responses.
              [Learn more technical details here](https://towardsdatascience.com/how-to-sample-from-language-models-682bceb97277).

          top_p: Use nucleus sampling.

              In nucleus sampling, we compute the cumulative distribution over all the options
              for each subsequent token in decreasing probability order and cut it off once it
              reaches a particular probability specified by `top_p`. You should either alter
              `temperature` or `top_p`, but not both.

          extra_headers: Send extra headers

          extra_query: Add additional query parameters to the request

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        ...

    @overload
    def create(
        self,
        *,
        max_tokens_to_sample: int,
        model: Union[str, Literal["claude-2.1", "claude-instant-1"]],
        prompt: str,
        stream: Literal[True],
        metadata: completion_create_params.Metadata | NotGiven = NOT_GIVEN,
        stop_sequences: List[str] | NotGiven = NOT_GIVEN,
        temperature: float | NotGiven = NOT_GIVEN,
        top_k: int | NotGiven = NOT_GIVEN,
        top_p: float | NotGiven = NOT_GIVEN,
        # Use the following arguments if you need to pass additional parameters to the API that aren't available via kwargs.
        # The extra values given here take precedence over values defined on the client or passed to this method.
        extra_headers: Headers | None = None,
        extra_query: Query | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = 600,
    ) -> Stream[Completion]:
        """
        Create a Completion

        Args:
          max_tokens_to_sample: The maximum number of tokens to generate before stopping.

              Note that our models may stop _before_ reaching this maximum. This parameter
              only specifies the absolute maximum number of tokens to generate.

          model: The model that will complete your prompt.

              As we improve Claude, we develop new versions of it that you can query. The
              `model` parameter controls which version of Claude responds to your request.
              Right now we offer two model families: Claude, and Claude Instant. You can use
              them by setting `model` to `"claude-2.1"` or `"claude-instant-1.2"`,
              respectively.

              See [models](https://docs.anthropic.com/claude/reference/selecting-a-model) for
              additional details and options.

          prompt: The prompt that you want Claude to complete.

              For proper response generation you will need to format your prompt using
              alternating `\n\nHuman:` and `\n\nAssistant:` conversational turns. For example:

              ```
              "\n\nHuman: {userQuestion}\n\nAssistant:"
              ```

              See
              [prompt validation](https://anthropic.readme.io/claude/reference/prompt-validation)
              and our guide to
              [prompt design](https://docs.anthropic.com/claude/docs/introduction-to-prompt-design)
              for more details.

          stream: Whether to incrementally stream the response using server-sent events.

              See [streaming](https://docs.anthropic.com/claude/reference/streaming) for
              details.

          metadata: An object describing metadata about the request.

          stop_sequences: Sequences that will cause the model to stop generating.

              Our models stop on `"\n\nHuman:"`, and may include additional built-in stop
              sequences in the future. By providing the stop_sequences parameter, you may
              include additional strings that will cause the model to stop generating.

          temperature: Amount of randomness injected into the response.

              Defaults to 1. Ranges from 0 to 1. Use temp closer to 0 for analytical /
              multiple choice, and closer to 1 for creative and generative tasks.

          top_k: Only sample from the top K options for each subsequent token.

              Used to remove "long tail" low probability responses.
              [Learn more technical details here](https://towardsdatascience.com/how-to-sample-from-language-models-682bceb97277).

          top_p: Use nucleus sampling.

              In nucleus sampling, we compute the cumulative distribution over all the options
              for each subsequent token in decreasing probability order and cut it off once it
              reaches a particular probability specified by `top_p`. You should either alter
              `temperature` or `top_p`, but not both.

          extra_headers: Send extra headers

          extra_query: Add additional query parameters to the request

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        ...

    @overload
    def create(
        self,
        *,
        max_tokens_to_sample: int,
        model: Union[str, Literal["claude-2.1", "claude-instant-1"]],
        prompt: str,
        stream: bool,
        metadata: completion_create_params.Metadata | NotGiven = NOT_GIVEN,
        stop_sequences: List[str] | NotGiven = NOT_GIVEN,
        temperature: float | NotGiven = NOT_GIVEN,
        top_k: int | NotGiven = NOT_GIVEN,
        top_p: float | NotGiven = NOT_GIVEN,
        # Use the following arguments if you need to pass additional parameters to the API that aren't available via kwargs.
        # The extra values given here take precedence over values defined on the client or passed to this method.
        extra_headers: Headers | None = None,
        extra_query: Query | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = 600,
    ) -> Completion | Stream[Completion]:
        """
        Create a Completion

        Args:
          max_tokens_to_sample: The maximum number of tokens to generate before stopping.

              Note that our models may stop _before_ reaching this maximum. This parameter
              only specifies the absolute maximum number of tokens to generate.

          model: The model that will complete your prompt.

              As we improve Claude, we develop new versions of it that you can query. The
              `model` parameter controls which version of Claude responds to your request.
              Right now we offer two model families: Claude, and Claude Instant. You can use
              them by setting `model` to `"claude-2.1"` or `"claude-instant-1.2"`,
              respectively.

              See [models](https://docs.anthropic.com/claude/reference/selecting-a-model) for
              additional details and options.

          prompt: The prompt that you want Claude to complete.

              For proper response generation you will need to format your prompt using
              alternating `\n\nHuman:` and `\n\nAssistant:` conversational turns. For example:

              ```
              "\n\nHuman: {userQuestion}\n\nAssistant:"
              ```

              See
              [prompt validation](https://anthropic.readme.io/claude/reference/prompt-validation)
              and our guide to
              [prompt design](https://docs.anthropic.com/claude/docs/introduction-to-prompt-design)
              for more details.

          stream: Whether to incrementally stream the response using server-sent events.

              See [streaming](https://docs.anthropic.com/claude/reference/streaming) for
              details.

          metadata: An object describing metadata about the request.

          stop_sequences: Sequences that will cause the model to stop generating.

              Our models stop on `"\n\nHuman:"`, and may include additional built-in stop
              sequences in the future. By providing the stop_sequences parameter, you may
              include additional strings that will cause the model to stop generating.

          temperature: Amount of randomness injected into the response.

              Defaults to 1. Ranges from 0 to 1. Use temp closer to 0 for analytical /
              multiple choice, and closer to 1 for creative and generative tasks.

          top_k: Only sample from the top K options for each subsequent token.

              Used to remove "long tail" low probability responses.
              [Learn more technical details here](https://towardsdatascience.com/how-to-sample-from-language-models-682bceb97277).

          top_p: Use nucleus sampling.

              In nucleus sampling, we compute the cumulative distribution over all the options
              for each subsequent token in decreasing probability order and cut it off once it
              reaches a particular probability specified by `top_p`. You should either alter
              `temperature` or `top_p`, but not both.

          extra_headers: Send extra headers

          extra_query: Add additional query parameters to the request

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        ...

    @required_args(["max_tokens_to_sample", "model", "prompt"], ["max_tokens_to_sample", "model", "prompt", "stream"])
    def create(
        self,
        *,
        max_tokens_to_sample: int,
        model: Union[str, Literal["claude-2.1", "claude-instant-1"]],
        prompt: str,
        metadata: completion_create_params.Metadata | NotGiven = NOT_GIVEN,
        stop_sequences: List[str] | NotGiven = NOT_GIVEN,
        stream: Literal[False] | Literal[True] | NotGiven = NOT_GIVEN,
        temperature: float | NotGiven = NOT_GIVEN,
        top_k: int | NotGiven = NOT_GIVEN,
        top_p: float | NotGiven = NOT_GIVEN,
        # Use the following arguments if you need to pass additional parameters to the API that aren't available via kwargs.
        # The extra values given here take precedence over values defined on the client or passed to this method.
        extra_headers: Headers | None = None,
        extra_query: Query | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = 600,
    ) -> Completion | Stream[Completion]:
        return self._post(
            "/v1/complete",
            body=maybe_transform(
                {
                    "max_tokens_to_sample": max_tokens_to_sample,
                    "model": model,
                    "prompt": prompt,
                    "metadata": metadata,
                    "stop_sequences": stop_sequences,
                    "stream": stream,
                    "temperature": temperature,
                    "top_k": top_k,
                    "top_p": top_p,
                },
                completion_create_params.CompletionCreateParams,
            ),
            options=make_request_options(
                extra_headers=extra_headers, extra_query=extra_query, extra_body=extra_body, timeout=timeout
            ),
            cast_to=Completion,
            stream=stream or False,
            stream_cls=Stream[Completion],
        )


class AsyncCompletions(AsyncAPIResource):
    with_raw_response: AsyncCompletionsWithRawResponse

    def __init__(self, client: AsyncAnthropic) -> None:
        super().__init__(client)
        self.with_raw_response = AsyncCompletionsWithRawResponse(self)

    @overload
    async def create(
        self,
        *,
        max_tokens_to_sample: int,
        model: Union[str, Literal["claude-2.1", "claude-instant-1"]],
        prompt: str,
        metadata: completion_create_params.Metadata | NotGiven = NOT_GIVEN,
        stop_sequences: List[str] | NotGiven = NOT_GIVEN,
        stream: Literal[False] | NotGiven = NOT_GIVEN,
        temperature: float | NotGiven = NOT_GIVEN,
        top_k: int | NotGiven = NOT_GIVEN,
        top_p: float | NotGiven = NOT_GIVEN,
        # Use the following arguments if you need to pass additional parameters to the API that aren't available via kwargs.
        # The extra values given here take precedence over values defined on the client or passed to this method.
        extra_headers: Headers | None = None,
        extra_query: Query | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = 600,
    ) -> Completion:
        """
        Create a Completion

        Args:
          max_tokens_to_sample: The maximum number of tokens to generate before stopping.

              Note that our models may stop _before_ reaching this maximum. This parameter
              only specifies the absolute maximum number of tokens to generate.

          model: The model that will complete your prompt.

              As we improve Claude, we develop new versions of it that you can query. The
              `model` parameter controls which version of Claude responds to your request.
              Right now we offer two model families: Claude, and Claude Instant. You can use
              them by setting `model` to `"claude-2.1"` or `"claude-instant-1.2"`,
              respectively.

              See [models](https://docs.anthropic.com/claude/reference/selecting-a-model) for
              additional details and options.

          prompt: The prompt that you want Claude to complete.

              For proper response generation you will need to format your prompt using
              alternating `\n\nHuman:` and `\n\nAssistant:` conversational turns. For example:

              ```
              "\n\nHuman: {userQuestion}\n\nAssistant:"
              ```

              See
              [prompt validation](https://anthropic.readme.io/claude/reference/prompt-validation)
              and our guide to
              [prompt design](https://docs.anthropic.com/claude/docs/introduction-to-prompt-design)
              for more details.

          metadata: An object describing metadata about the request.

          stop_sequences: Sequences that will cause the model to stop generating.

              Our models stop on `"\n\nHuman:"`, and may include additional built-in stop
              sequences in the future. By providing the stop_sequences parameter, you may
              include additional strings that will cause the model to stop generating.

          stream: Whether to incrementally stream the response using server-sent events.

              See [streaming](https://docs.anthropic.com/claude/reference/streaming) for
              details.

          temperature: Amount of randomness injected into the response.

              Defaults to 1. Ranges from 0 to 1. Use temp closer to 0 for analytical /
              multiple choice, and closer to 1 for creative and generative tasks.

          top_k: Only sample from the top K options for each subsequent token.

              Used to remove "long tail" low probability responses.
              [Learn more technical details here](https://towardsdatascience.com/how-to-sample-from-language-models-682bceb97277).

          top_p: Use nucleus sampling.

              In nucleus sampling, we compute the cumulative distribution over all the options
              for each subsequent token in decreasing probability order and cut it off once it
              reaches a particular probability specified by `top_p`. You should either alter
              `temperature` or `top_p`, but not both.

          extra_headers: Send extra headers

          extra_query: Add additional query parameters to the request

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        ...

    @overload
    async def create(
        self,
        *,
        max_tokens_to_sample: int,
        model: Union[str, Literal["claude-2.1", "claude-instant-1"]],
        prompt: str,
        stream: Literal[True],
        metadata: completion_create_params.Metadata | NotGiven = NOT_GIVEN,
        stop_sequences: List[str] | NotGiven = NOT_GIVEN,
        temperature: float | NotGiven = NOT_GIVEN,
        top_k: int | NotGiven = NOT_GIVEN,
        top_p: float | NotGiven = NOT_GIVEN,
        # Use the following arguments if you need to pass additional parameters to the API that aren't available via kwargs.
        # The extra values given here take precedence over values defined on the client or passed to this method.
        extra_headers: Headers | None = None,
        extra_query: Query | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = 600,
    ) -> AsyncStream[Completion]:
        """
        Create a Completion

        Args:
          max_tokens_to_sample: The maximum number of tokens to generate before stopping.

              Note that our models may stop _before_ reaching this maximum. This parameter
              only specifies the absolute maximum number of tokens to generate.

          model: The model that will complete your prompt.

              As we improve Claude, we develop new versions of it that you can query. The
              `model` parameter controls which version of Claude responds to your request.
              Right now we offer two model families: Claude, and Claude Instant. You can use
              them by setting `model` to `"claude-2.1"` or `"claude-instant-1.2"`,
              respectively.

              See [models](https://docs.anthropic.com/claude/reference/selecting-a-model) for
              additional details and options.

          prompt: The prompt that you want Claude to complete.

              For proper response generation you will need to format your prompt using
              alternating `\n\nHuman:` and `\n\nAssistant:` conversational turns. For example:

              ```
              "\n\nHuman: {userQuestion}\n\nAssistant:"
              ```

              See
              [prompt validation](https://anthropic.readme.io/claude/reference/prompt-validation)
              and our guide to
              [prompt design](https://docs.anthropic.com/claude/docs/introduction-to-prompt-design)
              for more details.

          stream: Whether to incrementally stream the response using server-sent events.

              See [streaming](https://docs.anthropic.com/claude/reference/streaming) for
              details.

          metadata: An object describing metadata about the request.

          stop_sequences: Sequences that will cause the model to stop generating.

              Our models stop on `"\n\nHuman:"`, and may include additional built-in stop
              sequences in the future. By providing the stop_sequences parameter, you may
              include additional strings that will cause the model to stop generating.

          temperature: Amount of randomness injected into the response.

              Defaults to 1. Ranges from 0 to 1. Use temp closer to 0 for analytical /
              multiple choice, and closer to 1 for creative and generative tasks.

          top_k: Only sample from the top K options for each subsequent token.

              Used to remove "long tail" low probability responses.
              [Learn more technical details here](https://towardsdatascience.com/how-to-sample-from-language-models-682bceb97277).

          top_p: Use nucleus sampling.

              In nucleus sampling, we compute the cumulative distribution over all the options
              for each subsequent token in decreasing probability order and cut it off once it
              reaches a particular probability specified by `top_p`. You should either alter
              `temperature` or `top_p`, but not both.

          extra_headers: Send extra headers

          extra_query: Add additional query parameters to the request

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        ...

    @overload
    async def create(
        self,
        *,
        max_tokens_to_sample: int,
        model: Union[str, Literal["claude-2.1", "claude-instant-1"]],
        prompt: str,
        stream: bool,
        metadata: completion_create_params.Metadata | NotGiven = NOT_GIVEN,
        stop_sequences: List[str] | NotGiven = NOT_GIVEN,
        temperature: float | NotGiven = NOT_GIVEN,
        top_k: int | NotGiven = NOT_GIVEN,
        top_p: float | NotGiven = NOT_GIVEN,
        # Use the following arguments if you need to pass additional parameters to the API that aren't available via kwargs.
        # The extra values given here take precedence over values defined on the client or passed to this method.
        extra_headers: Headers | None = None,
        extra_query: Query | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = 600,
    ) -> Completion | AsyncStream[Completion]:
        """
        Create a Completion

        Args:
          max_tokens_to_sample: The maximum number of tokens to generate before stopping.

              Note that our models may stop _before_ reaching this maximum. This parameter
              only specifies the absolute maximum number of tokens to generate.

          model: The model that will complete your prompt.

              As we improve Claude, we develop new versions of it that you can query. The
              `model` parameter controls which version of Claude responds to your request.
              Right now we offer two model families: Claude, and Claude Instant. You can use
              them by setting `model` to `"claude-2.1"` or `"claude-instant-1.2"`,
              respectively.

              See [models](https://docs.anthropic.com/claude/reference/selecting-a-model) for
              additional details and options.

          prompt: The prompt that you want Claude to complete.

              For proper response generation you will need to format your prompt using
              alternating `\n\nHuman:` and `\n\nAssistant:` conversational turns. For example:

              ```
              "\n\nHuman: {userQuestion}\n\nAssistant:"
              ```

              See
              [prompt validation](https://anthropic.readme.io/claude/reference/prompt-validation)
              and our guide to
              [prompt design](https://docs.anthropic.com/claude/docs/introduction-to-prompt-design)
              for more details.

          stream: Whether to incrementally stream the response using server-sent events.

              See [streaming](https://docs.anthropic.com/claude/reference/streaming) for
              details.

          metadata: An object describing metadata about the request.

          stop_sequences: Sequences that will cause the model to stop generating.

              Our models stop on `"\n\nHuman:"`, and may include additional built-in stop
              sequences in the future. By providing the stop_sequences parameter, you may
              include additional strings that will cause the model to stop generating.

          temperature: Amount of randomness injected into the response.

              Defaults to 1. Ranges from 0 to 1. Use temp closer to 0 for analytical /
              multiple choice, and closer to 1 for creative and generative tasks.

          top_k: Only sample from the top K options for each subsequent token.

              Used to remove "long tail" low probability responses.
              [Learn more technical details here](https://towardsdatascience.com/how-to-sample-from-language-models-682bceb97277).

          top_p: Use nucleus sampling.

              In nucleus sampling, we compute the cumulative distribution over all the options
              for each subsequent token in decreasing probability order and cut it off once it
              reaches a particular probability specified by `top_p`. You should either alter
              `temperature` or `top_p`, but not both.

          extra_headers: Send extra headers

          extra_query: Add additional query parameters to the request

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        ...

    @required_args(["max_tokens_to_sample", "model", "prompt"], ["max_tokens_to_sample", "model", "prompt", "stream"])
    async def create(
        self,
        *,
        max_tokens_to_sample: int,
        model: Union[str, Literal["claude-2.1", "claude-instant-1"]],
        prompt: str,
        metadata: completion_create_params.Metadata | NotGiven = NOT_GIVEN,
        stop_sequences: List[str] | NotGiven = NOT_GIVEN,
        stream: Literal[False] | Literal[True] | NotGiven = NOT_GIVEN,
        temperature: float | NotGiven = NOT_GIVEN,
        top_k: int | NotGiven = NOT_GIVEN,
        top_p: float | NotGiven = NOT_GIVEN,
        # Use the following arguments if you need to pass additional parameters to the API that aren't available via kwargs.
        # The extra values given here take precedence over values defined on the client or passed to this method.
        extra_headers: Headers | None = None,
        extra_query: Query | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = 600,
    ) -> Completion | AsyncStream[Completion]:
        return await self._post(
            "/v1/complete",
            body=maybe_transform(
                {
                    "max_tokens_to_sample": max_tokens_to_sample,
                    "model": model,
                    "prompt": prompt,
                    "metadata": metadata,
                    "stop_sequences": stop_sequences,
                    "stream": stream,
                    "temperature": temperature,
                    "top_k": top_k,
                    "top_p": top_p,
                },
                completion_create_params.CompletionCreateParams,
            ),
            options=make_request_options(
                extra_headers=extra_headers, extra_query=extra_query, extra_body=extra_body, timeout=timeout
            ),
            cast_to=Completion,
            stream=stream or False,
            stream_cls=AsyncStream[Completion],
        )


class CompletionsWithRawResponse:
    def __init__(self, completions: Completions) -> None:
        self.create = to_raw_response_wrapper(
            completions.create,
        )


class AsyncCompletionsWithRawResponse:
    def __init__(self, completions: AsyncCompletions) -> None:
        self.create = async_to_raw_response_wrapper(
            completions.create,
        )
