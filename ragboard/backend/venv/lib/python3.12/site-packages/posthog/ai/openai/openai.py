import time
import uuid
from typing import Any, Dict, List, Optional

try:
    import openai
except ImportError:
    raise ModuleNotFoundError(
        "Please install the OpenAI SDK to use this feature: 'pip install openai'"
    )

from posthog.ai.utils import (
    call_llm_and_track_usage,
    get_model_params,
    with_privacy_mode,
)
from posthog.client import Client as PostHogClient


class OpenAI(openai.OpenAI):
    """
    A wrapper around the OpenAI SDK that automatically sends LLM usage events to PostHog.
    """

    _ph_client: PostHogClient

    def __init__(self, posthog_client: PostHogClient, **kwargs):
        """
        Args:
            api_key: OpenAI API key.
            posthog_client: If provided, events will be captured via this client instead
                            of the global posthog.
            **openai_config: Any additional keyword args to set on openai (e.g. organization="xxx").
        """
        super().__init__(**kwargs)
        self._ph_client = posthog_client

        # Store original objects after parent initialization (only if they exist)
        self._original_chat = getattr(self, "chat", None)
        self._original_embeddings = getattr(self, "embeddings", None)
        self._original_beta = getattr(self, "beta", None)
        self._original_responses = getattr(self, "responses", None)

        # Replace with wrapped versions (only if originals exist)
        if self._original_chat is not None:
            self.chat = WrappedChat(self, self._original_chat)

        if self._original_embeddings is not None:
            self.embeddings = WrappedEmbeddings(self, self._original_embeddings)

        if self._original_beta is not None:
            self.beta = WrappedBeta(self, self._original_beta)

        if self._original_responses is not None:
            self.responses = WrappedResponses(self, self._original_responses)


class WrappedResponses:
    """Wrapper for OpenAI responses that tracks usage in PostHog."""

    def __init__(self, client: OpenAI, original_responses):
        self._client = client
        self._original = original_responses

    def __getattr__(self, name):
        """Fallback to original responses object for any methods we don't explicitly handle."""
        return getattr(self._original, name)

    def create(
        self,
        posthog_distinct_id: Optional[str] = None,
        posthog_trace_id: Optional[str] = None,
        posthog_properties: Optional[Dict[str, Any]] = None,
        posthog_privacy_mode: bool = False,
        posthog_groups: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ):
        if posthog_trace_id is None:
            posthog_trace_id = str(uuid.uuid4())

        if kwargs.get("stream", False):
            return self._create_streaming(
                posthog_distinct_id,
                posthog_trace_id,
                posthog_properties,
                posthog_privacy_mode,
                posthog_groups,
                **kwargs,
            )

        return call_llm_and_track_usage(
            posthog_distinct_id,
            self._client._ph_client,
            "openai",
            posthog_trace_id,
            posthog_properties,
            posthog_privacy_mode,
            posthog_groups,
            self._client.base_url,
            self._original.create,
            **kwargs,
        )

    def _create_streaming(
        self,
        posthog_distinct_id: Optional[str],
        posthog_trace_id: Optional[str],
        posthog_properties: Optional[Dict[str, Any]],
        posthog_privacy_mode: bool,
        posthog_groups: Optional[Dict[str, Any]],
        **kwargs: Any,
    ):
        start_time = time.time()
        usage_stats: Dict[str, int] = {}
        final_content = []
        response = self._original.create(**kwargs)

        def generator():
            nonlocal usage_stats
            nonlocal final_content  # noqa: F824

            try:
                for chunk in response:
                    if hasattr(chunk, "type") and chunk.type == "response.completed":
                        res = chunk.response
                        if res.output and len(res.output) > 0:
                            final_content.append(res.output[0])

                    if hasattr(chunk, "usage") and chunk.usage:
                        usage_stats = {
                            k: getattr(chunk.usage, k, 0)
                            for k in [
                                "input_tokens",
                                "output_tokens",
                                "total_tokens",
                            ]
                        }

                        # Add support for cached tokens
                        if hasattr(chunk.usage, "output_tokens_details") and hasattr(
                            chunk.usage.output_tokens_details, "reasoning_tokens"
                        ):
                            usage_stats["reasoning_tokens"] = (
                                chunk.usage.output_tokens_details.reasoning_tokens
                            )

                        if hasattr(chunk.usage, "input_tokens_details") and hasattr(
                            chunk.usage.input_tokens_details, "cached_tokens"
                        ):
                            usage_stats["cache_read_input_tokens"] = (
                                chunk.usage.input_tokens_details.cached_tokens
                            )

                    yield chunk

            finally:
                end_time = time.time()
                latency = end_time - start_time
                output = final_content
                self._capture_streaming_event(
                    posthog_distinct_id,
                    posthog_trace_id,
                    posthog_properties,
                    posthog_privacy_mode,
                    posthog_groups,
                    kwargs,
                    usage_stats,
                    latency,
                    output,
                )

        return generator()

    def _capture_streaming_event(
        self,
        posthog_distinct_id: Optional[str],
        posthog_trace_id: Optional[str],
        posthog_properties: Optional[Dict[str, Any]],
        posthog_privacy_mode: bool,
        posthog_groups: Optional[Dict[str, Any]],
        kwargs: Dict[str, Any],
        usage_stats: Dict[str, int],
        latency: float,
        output: Any,
        tool_calls: Optional[List[Dict[str, Any]]] = None,
    ):
        if posthog_trace_id is None:
            posthog_trace_id = str(uuid.uuid4())

        event_properties = {
            "$ai_provider": "openai",
            "$ai_model": kwargs.get("model"),
            "$ai_model_parameters": get_model_params(kwargs),
            "$ai_input": with_privacy_mode(
                self._client._ph_client, posthog_privacy_mode, kwargs.get("input")
            ),
            "$ai_output_choices": with_privacy_mode(
                self._client._ph_client,
                posthog_privacy_mode,
                output,
            ),
            "$ai_http_status": 200,
            "$ai_input_tokens": usage_stats.get("input_tokens", 0),
            "$ai_output_tokens": usage_stats.get("output_tokens", 0),
            "$ai_cache_read_input_tokens": usage_stats.get(
                "cache_read_input_tokens", 0
            ),
            "$ai_reasoning_tokens": usage_stats.get("reasoning_tokens", 0),
            "$ai_latency": latency,
            "$ai_trace_id": posthog_trace_id,
            "$ai_base_url": str(self._client.base_url),
            **(posthog_properties or {}),
        }

        if tool_calls:
            event_properties["$ai_tools"] = with_privacy_mode(
                self._client._ph_client,
                posthog_privacy_mode,
                tool_calls,
            )

        if posthog_distinct_id is None:
            event_properties["$process_person_profile"] = False

        if hasattr(self._client._ph_client, "capture"):
            self._client._ph_client.capture(
                distinct_id=posthog_distinct_id or posthog_trace_id,
                event="$ai_generation",
                properties=event_properties,
                groups=posthog_groups,
            )

    def parse(
        self,
        posthog_distinct_id: Optional[str] = None,
        posthog_trace_id: Optional[str] = None,
        posthog_properties: Optional[Dict[str, Any]] = None,
        posthog_privacy_mode: bool = False,
        posthog_groups: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ):
        """
        Parse structured output using OpenAI's 'responses.parse' method, but also track usage in PostHog.

        Args:
            posthog_distinct_id: Optional ID to associate with the usage event.
            posthog_trace_id: Optional trace UUID for linking events.
            posthog_properties: Optional dictionary of extra properties to include in the event.
            posthog_privacy_mode: Whether to anonymize the input and output.
            posthog_groups: Optional dictionary of groups to associate with the event.
            **kwargs: Any additional parameters for the OpenAI Responses Parse API.

        Returns:
            The response from OpenAI's responses.parse call.
        """
        return call_llm_and_track_usage(
            posthog_distinct_id,
            self._client._ph_client,
            "openai",
            posthog_trace_id,
            posthog_properties,
            posthog_privacy_mode,
            posthog_groups,
            self._client.base_url,
            self._original.parse,
            **kwargs,
        )


class WrappedChat:
    """Wrapper for OpenAI chat that tracks usage in PostHog."""

    def __init__(self, client: OpenAI, original_chat):
        self._client = client
        self._original = original_chat

    def __getattr__(self, name):
        """Fallback to original chat object for any methods we don't explicitly handle."""
        return getattr(self._original, name)

    @property
    def completions(self):
        return WrappedCompletions(self._client, self._original.completions)


class WrappedCompletions:
    """Wrapper for OpenAI chat completions that tracks usage in PostHog."""

    def __init__(self, client: OpenAI, original_completions):
        self._client = client
        self._original = original_completions

    def __getattr__(self, name):
        """Fallback to original completions object for any methods we don't explicitly handle."""
        return getattr(self._original, name)

    def create(
        self,
        posthog_distinct_id: Optional[str] = None,
        posthog_trace_id: Optional[str] = None,
        posthog_properties: Optional[Dict[str, Any]] = None,
        posthog_privacy_mode: bool = False,
        posthog_groups: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ):
        if posthog_trace_id is None:
            posthog_trace_id = str(uuid.uuid4())

        if kwargs.get("stream", False):
            return self._create_streaming(
                posthog_distinct_id,
                posthog_trace_id,
                posthog_properties,
                posthog_privacy_mode,
                posthog_groups,
                **kwargs,
            )

        return call_llm_and_track_usage(
            posthog_distinct_id,
            self._client._ph_client,
            "openai",
            posthog_trace_id,
            posthog_properties,
            posthog_privacy_mode,
            posthog_groups,
            self._client.base_url,
            self._original.create,
            **kwargs,
        )

    def _create_streaming(
        self,
        posthog_distinct_id: Optional[str],
        posthog_trace_id: Optional[str],
        posthog_properties: Optional[Dict[str, Any]],
        posthog_privacy_mode: bool,
        posthog_groups: Optional[Dict[str, Any]],
        **kwargs: Any,
    ):
        start_time = time.time()
        usage_stats: Dict[str, int] = {}
        accumulated_content = []
        accumulated_tools = {}
        if "stream_options" not in kwargs:
            kwargs["stream_options"] = {}
        kwargs["stream_options"]["include_usage"] = True
        response = self._original.create(**kwargs)

        def generator():
            nonlocal usage_stats
            nonlocal accumulated_content  # noqa: F824
            nonlocal accumulated_tools  # noqa: F824

            try:
                for chunk in response:
                    if hasattr(chunk, "usage") and chunk.usage:
                        usage_stats = {
                            k: getattr(chunk.usage, k, 0)
                            for k in [
                                "prompt_tokens",
                                "completion_tokens",
                                "total_tokens",
                            ]
                        }

                        # Add support for cached tokens
                        if hasattr(chunk.usage, "prompt_tokens_details") and hasattr(
                            chunk.usage.prompt_tokens_details, "cached_tokens"
                        ):
                            usage_stats["cache_read_input_tokens"] = (
                                chunk.usage.prompt_tokens_details.cached_tokens
                            )

                        if hasattr(chunk.usage, "output_tokens_details") and hasattr(
                            chunk.usage.output_tokens_details, "reasoning_tokens"
                        ):
                            usage_stats["reasoning_tokens"] = (
                                chunk.usage.output_tokens_details.reasoning_tokens
                            )

                    if (
                        hasattr(chunk, "choices")
                        and chunk.choices
                        and len(chunk.choices) > 0
                    ):
                        if chunk.choices[0].delta and chunk.choices[0].delta.content:
                            content = chunk.choices[0].delta.content
                            if content:
                                accumulated_content.append(content)

                        # Process tool calls
                        tool_calls = getattr(chunk.choices[0].delta, "tool_calls", None)
                        if tool_calls:
                            for tool_call in tool_calls:
                                index = tool_call.index
                                if index not in accumulated_tools:
                                    accumulated_tools[index] = tool_call
                                else:
                                    # Append arguments for existing tool calls
                                    if hasattr(tool_call, "function") and hasattr(
                                        tool_call.function, "arguments"
                                    ):
                                        accumulated_tools[
                                            index
                                        ].function.arguments += (
                                            tool_call.function.arguments
                                        )

                    yield chunk

            finally:
                end_time = time.time()
                latency = end_time - start_time
                output = "".join(accumulated_content)
                tools = list(accumulated_tools.values()) if accumulated_tools else None
                self._capture_streaming_event(
                    posthog_distinct_id,
                    posthog_trace_id,
                    posthog_properties,
                    posthog_privacy_mode,
                    posthog_groups,
                    kwargs,
                    usage_stats,
                    latency,
                    output,
                    tools,
                )

        return generator()

    def _capture_streaming_event(
        self,
        posthog_distinct_id: Optional[str],
        posthog_trace_id: Optional[str],
        posthog_properties: Optional[Dict[str, Any]],
        posthog_privacy_mode: bool,
        posthog_groups: Optional[Dict[str, Any]],
        kwargs: Dict[str, Any],
        usage_stats: Dict[str, int],
        latency: float,
        output: Any,
        tool_calls: Optional[List[Dict[str, Any]]] = None,
    ):
        if posthog_trace_id is None:
            posthog_trace_id = str(uuid.uuid4())

        event_properties = {
            "$ai_provider": "openai",
            "$ai_model": kwargs.get("model"),
            "$ai_model_parameters": get_model_params(kwargs),
            "$ai_input": with_privacy_mode(
                self._client._ph_client, posthog_privacy_mode, kwargs.get("messages")
            ),
            "$ai_output_choices": with_privacy_mode(
                self._client._ph_client,
                posthog_privacy_mode,
                [{"content": output, "role": "assistant"}],
            ),
            "$ai_http_status": 200,
            "$ai_input_tokens": usage_stats.get("prompt_tokens", 0),
            "$ai_output_tokens": usage_stats.get("completion_tokens", 0),
            "$ai_cache_read_input_tokens": usage_stats.get(
                "cache_read_input_tokens", 0
            ),
            "$ai_reasoning_tokens": usage_stats.get("reasoning_tokens", 0),
            "$ai_latency": latency,
            "$ai_trace_id": posthog_trace_id,
            "$ai_base_url": str(self._client.base_url),
            **(posthog_properties or {}),
        }

        if tool_calls:
            event_properties["$ai_tools"] = with_privacy_mode(
                self._client._ph_client,
                posthog_privacy_mode,
                tool_calls,
            )

        if posthog_distinct_id is None:
            event_properties["$process_person_profile"] = False

        if hasattr(self._client._ph_client, "capture"):
            self._client._ph_client.capture(
                distinct_id=posthog_distinct_id or posthog_trace_id,
                event="$ai_generation",
                properties=event_properties,
                groups=posthog_groups,
            )


class WrappedEmbeddings:
    """Wrapper for OpenAI embeddings that tracks usage in PostHog."""

    def __init__(self, client: OpenAI, original_embeddings):
        self._client = client
        self._original = original_embeddings

    def __getattr__(self, name):
        """Fallback to original embeddings object for any methods we don't explicitly handle."""
        return getattr(self._original, name)

    def create(
        self,
        posthog_distinct_id: Optional[str] = None,
        posthog_trace_id: Optional[str] = None,
        posthog_properties: Optional[Dict[str, Any]] = None,
        posthog_privacy_mode: bool = False,
        posthog_groups: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ):
        """
        Create an embedding using OpenAI's 'embeddings.create' method, but also track usage in PostHog.

        Args:
            posthog_distinct_id: Optional ID to associate with the usage event.
            posthog_trace_id: Optional trace UUID for linking events.
            posthog_properties: Optional dictionary of extra properties to include in the event.
            posthog_privacy_mode: Whether to anonymize the input and output.
            posthog_groups: Optional dictionary of groups to associate with the event.
            **kwargs: Any additional parameters for the OpenAI Embeddings API.

        Returns:
            The response from OpenAI's embeddings.create call.
        """
        if posthog_trace_id is None:
            posthog_trace_id = str(uuid.uuid4())

        start_time = time.time()
        response = self._original.create(**kwargs)
        end_time = time.time()

        # Extract usage statistics if available
        usage_stats = {}
        if hasattr(response, "usage") and response.usage:
            usage_stats = {
                "prompt_tokens": getattr(response.usage, "prompt_tokens", 0),
                "total_tokens": getattr(response.usage, "total_tokens", 0),
            }

        latency = end_time - start_time

        # Build the event properties
        event_properties = {
            "$ai_provider": "openai",
            "$ai_model": kwargs.get("model"),
            "$ai_input": with_privacy_mode(
                self._client._ph_client, posthog_privacy_mode, kwargs.get("input")
            ),
            "$ai_http_status": 200,
            "$ai_input_tokens": usage_stats.get("prompt_tokens", 0),
            "$ai_latency": latency,
            "$ai_trace_id": posthog_trace_id,
            "$ai_base_url": str(self._client.base_url),
            **(posthog_properties or {}),
        }

        if posthog_distinct_id is None:
            event_properties["$process_person_profile"] = False

        # Send capture event for embeddings
        if hasattr(self._client._ph_client, "capture"):
            self._client._ph_client.capture(
                distinct_id=posthog_distinct_id or posthog_trace_id,
                event="$ai_embedding",
                properties=event_properties,
                groups=posthog_groups,
            )

        return response


class WrappedBeta:
    """Wrapper for OpenAI beta features that tracks usage in PostHog."""

    def __init__(self, client: OpenAI, original_beta):
        self._client = client
        self._original = original_beta

    def __getattr__(self, name):
        """Fallback to original beta object for any methods we don't explicitly handle."""
        return getattr(self._original, name)

    @property
    def chat(self):
        return WrappedBetaChat(self._client, self._original.chat)


class WrappedBetaChat:
    """Wrapper for OpenAI beta chat that tracks usage in PostHog."""

    def __init__(self, client: OpenAI, original_beta_chat):
        self._client = client
        self._original = original_beta_chat

    def __getattr__(self, name):
        """Fallback to original beta chat object for any methods we don't explicitly handle."""
        return getattr(self._original, name)

    @property
    def completions(self):
        return WrappedBetaCompletions(self._client, self._original.completions)


class WrappedBetaCompletions:
    """Wrapper for OpenAI beta chat completions that tracks usage in PostHog."""

    def __init__(self, client: OpenAI, original_beta_completions):
        self._client = client
        self._original = original_beta_completions

    def __getattr__(self, name):
        """Fallback to original beta completions object for any methods we don't explicitly handle."""
        return getattr(self._original, name)

    def parse(
        self,
        posthog_distinct_id: Optional[str] = None,
        posthog_trace_id: Optional[str] = None,
        posthog_properties: Optional[Dict[str, Any]] = None,
        posthog_privacy_mode: bool = False,
        posthog_groups: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ):
        return call_llm_and_track_usage(
            posthog_distinct_id,
            self._client._ph_client,
            "openai",
            posthog_trace_id,
            posthog_properties,
            posthog_privacy_mode,
            posthog_groups,
            self._client.base_url,
            self._original.parse,
            **kwargs,
        )
