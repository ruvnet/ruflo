try:
    import anthropic
    from anthropic.resources import Messages
except ImportError:
    raise ModuleNotFoundError(
        "Please install the Anthropic SDK to use this feature: 'pip install anthropic'"
    )

import time
import uuid
from typing import Any, Dict, Optional

from posthog.ai.utils import (
    call_llm_and_track_usage,
    get_model_params,
    merge_system_prompt,
    with_privacy_mode,
)
from posthog.client import Client as PostHogClient


class Anthropic(anthropic.Anthropic):
    """
    A wrapper around the Anthropic SDK that automatically sends LLM usage events to PostHog.
    """

    _ph_client: PostHogClient

    def __init__(self, posthog_client: PostHogClient, **kwargs):
        """
        Args:
            posthog_client: PostHog client for tracking usage
            **kwargs: Additional arguments passed to the Anthropic client
        """
        super().__init__(**kwargs)
        self._ph_client = posthog_client
        self.messages = WrappedMessages(self)


class WrappedMessages(Messages):
    _client: Anthropic

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
        Create a message using Anthropic's API while tracking usage in PostHog.

        Args:
            posthog_distinct_id: Optional ID to associate with the usage event
            posthog_trace_id: Optional trace UUID for linking events
            posthog_properties: Optional dictionary of extra properties to include in the event
            posthog_privacy_mode: Whether to redact sensitive information in tracking
            posthog_groups: Optional group analytics properties
            **kwargs: Arguments passed to Anthropic's messages.create
        """
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
            "anthropic",
            posthog_trace_id,
            posthog_properties,
            posthog_privacy_mode,
            posthog_groups,
            self._client.base_url,
            super().create,
            **kwargs,
        )

    def stream(
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

        return self._create_streaming(
            posthog_distinct_id,
            posthog_trace_id,
            posthog_properties,
            posthog_privacy_mode,
            posthog_groups,
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
        usage_stats: Dict[str, int] = {"input_tokens": 0, "output_tokens": 0}
        accumulated_content = []
        response = super().create(**kwargs)

        def generator():
            nonlocal usage_stats
            nonlocal accumulated_content  # noqa: F824
            try:
                for event in response:
                    if hasattr(event, "usage") and event.usage:
                        usage_stats = {
                            k: getattr(event.usage, k, 0)
                            for k in [
                                "input_tokens",
                                "output_tokens",
                                "cache_read_input_tokens",
                                "cache_creation_input_tokens",
                            ]
                        }

                    if hasattr(event, "content") and event.content:
                        accumulated_content.append(event.content)

                    yield event

            finally:
                end_time = time.time()
                latency = end_time - start_time
                output = "".join(accumulated_content)

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
        output: str,
    ):
        if posthog_trace_id is None:
            posthog_trace_id = str(uuid.uuid4())

        event_properties = {
            "$ai_provider": "anthropic",
            "$ai_model": kwargs.get("model"),
            "$ai_model_parameters": get_model_params(kwargs),
            "$ai_input": with_privacy_mode(
                self._client._ph_client,
                posthog_privacy_mode,
                merge_system_prompt(kwargs, "anthropic"),
            ),
            "$ai_output_choices": with_privacy_mode(
                self._client._ph_client,
                posthog_privacy_mode,
                [{"content": output, "role": "assistant"}],
            ),
            "$ai_http_status": 200,
            "$ai_input_tokens": usage_stats.get("input_tokens", 0),
            "$ai_output_tokens": usage_stats.get("output_tokens", 0),
            "$ai_cache_read_input_tokens": usage_stats.get(
                "cache_read_input_tokens", 0
            ),
            "$ai_cache_creation_input_tokens": usage_stats.get(
                "cache_creation_input_tokens", 0
            ),
            "$ai_latency": latency,
            "$ai_trace_id": posthog_trace_id,
            "$ai_base_url": str(self._client.base_url),
            **(posthog_properties or {}),
        }

        if posthog_distinct_id is None:
            event_properties["$process_person_profile"] = False

        if hasattr(self._client._ph_client, "capture"):
            self._client._ph_client.capture(
                distinct_id=posthog_distinct_id or posthog_trace_id,
                event="$ai_generation",
                properties=event_properties,
                groups=posthog_groups,
            )
