import time
import uuid
from typing import Any, Callable, Dict, List, Optional

from httpx import URL

from posthog.client import Client as PostHogClient


def get_model_params(kwargs: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extracts model parameters from the kwargs dictionary.
    """
    model_params = {}
    for param in [
        "temperature",
        "max_tokens",  # Deprecated field
        "max_completion_tokens",
        "top_p",
        "frequency_penalty",
        "presence_penalty",
        "n",
        "stop",
        "stream",  # OpenAI-specific field
        "streaming",  # Anthropic-specific field
    ]:
        if param in kwargs and kwargs[param] is not None:
            model_params[param] = kwargs[param]
    return model_params


def get_usage(response, provider: str) -> Dict[str, Any]:
    if provider == "anthropic":
        return {
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
            "cache_read_input_tokens": response.usage.cache_read_input_tokens,
            "cache_creation_input_tokens": response.usage.cache_creation_input_tokens,
        }
    elif provider == "openai":
        cached_tokens = 0
        input_tokens = 0
        output_tokens = 0
        reasoning_tokens = 0

        # responses api
        if hasattr(response.usage, "input_tokens"):
            input_tokens = response.usage.input_tokens
        if hasattr(response.usage, "output_tokens"):
            output_tokens = response.usage.output_tokens
        if hasattr(response.usage, "input_tokens_details") and hasattr(
            response.usage.input_tokens_details, "cached_tokens"
        ):
            cached_tokens = response.usage.input_tokens_details.cached_tokens
        if hasattr(response.usage, "output_tokens_details") and hasattr(
            response.usage.output_tokens_details, "reasoning_tokens"
        ):
            reasoning_tokens = response.usage.output_tokens_details.reasoning_tokens

        # chat completions
        if hasattr(response.usage, "prompt_tokens"):
            input_tokens = response.usage.prompt_tokens
        if hasattr(response.usage, "completion_tokens"):
            output_tokens = response.usage.completion_tokens
        if hasattr(response.usage, "prompt_tokens_details") and hasattr(
            response.usage.prompt_tokens_details, "cached_tokens"
        ):
            cached_tokens = response.usage.prompt_tokens_details.cached_tokens

        return {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cache_read_input_tokens": cached_tokens,
            "reasoning_tokens": reasoning_tokens,
        }
    elif provider == "gemini":
        input_tokens = 0
        output_tokens = 0

        if hasattr(response, "usage_metadata") and response.usage_metadata:
            input_tokens = getattr(response.usage_metadata, "prompt_token_count", 0)
            output_tokens = getattr(
                response.usage_metadata, "candidates_token_count", 0
            )

        return {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cache_read_input_tokens": 0,
            "cache_creation_input_tokens": 0,
            "reasoning_tokens": 0,
        }
    return {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_input_tokens": 0,
        "cache_creation_input_tokens": 0,
        "reasoning_tokens": 0,
    }


def format_response(response, provider: str):
    """
    Format a regular (non-streaming) response.
    """
    output = []
    if response is None:
        return output
    if provider == "anthropic":
        return format_response_anthropic(response)
    elif provider == "openai":
        return format_response_openai(response)
    elif provider == "gemini":
        return format_response_gemini(response)
    return output


def format_response_anthropic(response):
    output = []
    for choice in response.content:
        if choice.text:
            output.append(
                {
                    "role": "assistant",
                    "content": choice.text,
                }
            )
    return output


def format_response_openai(response):
    output = []
    if hasattr(response, "choices"):
        for choice in response.choices:
            # Handle Chat Completions response format
            if hasattr(choice, "message") and choice.message and choice.message.content:
                output.append(
                    {
                        "content": choice.message.content,
                        "role": choice.message.role,
                    }
                )
    # Handle Responses API format
    if hasattr(response, "output"):
        for item in response.output:
            if item.type == "message":
                # Extract text content from the content list
                if hasattr(item, "content") and isinstance(item.content, list):
                    for content_item in item.content:
                        if (
                            hasattr(content_item, "type")
                            and content_item.type == "output_text"
                            and hasattr(content_item, "text")
                        ):
                            output.append(
                                {
                                    "content": content_item.text,
                                    "role": item.role,
                                }
                            )
                        elif hasattr(content_item, "text"):
                            output.append(
                                {
                                    "content": content_item.text,
                                    "role": item.role,
                                }
                            )
                        elif (
                            hasattr(content_item, "type")
                            and content_item.type == "input_image"
                            and hasattr(content_item, "image_url")
                        ):
                            output.append(
                                {
                                    "content": {
                                        "type": "image",
                                        "image": content_item.image_url,
                                    },
                                    "role": item.role,
                                }
                            )
                else:
                    output.append(
                        {
                            "content": item.content,
                            "role": item.role,
                        }
                    )
    return output


def format_response_gemini(response):
    output = []
    if hasattr(response, "candidates") and response.candidates:
        for candidate in response.candidates:
            if hasattr(candidate, "content") and candidate.content:
                content_text = ""
                if hasattr(candidate.content, "parts") and candidate.content.parts:
                    for part in candidate.content.parts:
                        if hasattr(part, "text") and part.text:
                            content_text += part.text
                if content_text:
                    output.append(
                        {
                            "role": "assistant",
                            "content": content_text,
                        }
                    )
            elif hasattr(candidate, "text") and candidate.text:
                output.append(
                    {
                        "role": "assistant",
                        "content": candidate.text,
                    }
                )
    elif hasattr(response, "text") and response.text:
        output.append(
            {
                "role": "assistant",
                "content": response.text,
            }
        )
    return output


def format_tool_calls(response, provider: str):
    if provider == "anthropic":
        if hasattr(response, "tools") and response.tools and len(response.tools) > 0:
            return response.tools
    elif provider == "openai":
        # Handle both Chat Completions and Responses API
        if hasattr(response, "choices") and response.choices:
            # Check for tool_calls in message (Chat Completions format)
            if (
                hasattr(response.choices[0], "message")
                and hasattr(response.choices[0].message, "tool_calls")
                and response.choices[0].message.tool_calls
            ):
                return response.choices[0].message.tool_calls

            # Check for tool_calls directly in response (Responses API format)
            if (
                hasattr(response.choices[0], "tool_calls")
                and response.choices[0].tool_calls
            ):
                return response.choices[0].tool_calls
    return None


def merge_system_prompt(kwargs: Dict[str, Any], provider: str):
    messages: List[Dict[str, Any]] = []
    if provider == "anthropic":
        messages = kwargs.get("messages") or []
        if kwargs.get("system") is None:
            return messages
        return [{"role": "system", "content": kwargs.get("system")}] + messages
    elif provider == "gemini":
        contents = kwargs.get("contents", [])
        if isinstance(contents, str):
            return [{"role": "user", "content": contents}]
        elif isinstance(contents, list):
            formatted = []
            for item in contents:
                if isinstance(item, str):
                    formatted.append({"role": "user", "content": item})
                elif hasattr(item, "text"):
                    formatted.append({"role": "user", "content": item.text})
                else:
                    formatted.append({"role": "user", "content": str(item)})
            return formatted
        else:
            return [{"role": "user", "content": str(contents)}]

    # For OpenAI, handle both Chat Completions and Responses API
    if kwargs.get("messages") is not None:
        messages = list(kwargs.get("messages", []))

    if kwargs.get("input") is not None:
        input_data = kwargs.get("input")
        if isinstance(input_data, list):
            messages.extend(input_data)
        else:
            messages.append({"role": "user", "content": input_data})

    # Check if system prompt is provided as a separate parameter
    if kwargs.get("system") is not None:
        has_system = any(msg.get("role") == "system" for msg in messages)
        if not has_system:
            messages = [{"role": "system", "content": kwargs.get("system")}] + messages

    # For Responses API, add instructions to the system prompt if provided
    if kwargs.get("instructions") is not None:
        # Find the system message if it exists
        system_idx = next(
            (i for i, msg in enumerate(messages) if msg.get("role") == "system"), None
        )

        if system_idx is not None:
            # Append instructions to existing system message
            system_content = messages[system_idx].get("content", "")
            messages[system_idx]["content"] = (
                f"{system_content}\n\n{kwargs.get('instructions')}"
            )
        else:
            # Create a new system message with instructions
            messages = [
                {"role": "system", "content": kwargs.get("instructions")}
            ] + messages

    return messages


def call_llm_and_track_usage(
    posthog_distinct_id: Optional[str],
    ph_client: PostHogClient,
    provider: str,
    posthog_trace_id: Optional[str],
    posthog_properties: Optional[Dict[str, Any]],
    posthog_privacy_mode: bool,
    posthog_groups: Optional[Dict[str, Any]],
    base_url: URL,
    call_method: Callable[..., Any],
    **kwargs: Any,
) -> Any:
    """
    Common usage-tracking logic for both sync and async calls.
    call_method: the llm call method (e.g. openai.chat.completions.create)
    """
    start_time = time.time()
    response = None
    error = None
    http_status = 200
    usage: Dict[str, Any] = {}
    error_params: Dict[str, any] = {}

    try:
        response = call_method(**kwargs)
    except Exception as exc:
        error = exc
        http_status = getattr(
            exc, "status_code", 0
        )  # default to 0 becuase its likely an SDK error
        error_params = {
            "$ai_is_error": True,
            "$ai_error": exc.__str__(),
        }
    finally:
        end_time = time.time()
        latency = end_time - start_time

        if posthog_trace_id is None:
            posthog_trace_id = str(uuid.uuid4())

        if response and (
            hasattr(response, "usage")
            or (provider == "gemini" and hasattr(response, "usage_metadata"))
        ):
            usage = get_usage(response, provider)

        messages = merge_system_prompt(kwargs, provider)

        event_properties = {
            "$ai_provider": provider,
            "$ai_model": kwargs.get("model"),
            "$ai_model_parameters": get_model_params(kwargs),
            "$ai_input": with_privacy_mode(ph_client, posthog_privacy_mode, messages),
            "$ai_output_choices": with_privacy_mode(
                ph_client, posthog_privacy_mode, format_response(response, provider)
            ),
            "$ai_http_status": http_status,
            "$ai_input_tokens": usage.get("input_tokens", 0),
            "$ai_output_tokens": usage.get("output_tokens", 0),
            "$ai_latency": latency,
            "$ai_trace_id": posthog_trace_id,
            "$ai_base_url": str(base_url),
            **(posthog_properties or {}),
            **(error_params or {}),
        }

        tool_calls = format_tool_calls(response, provider)
        if tool_calls:
            event_properties["$ai_tools"] = with_privacy_mode(
                ph_client, posthog_privacy_mode, tool_calls
            )

        if (
            usage.get("cache_read_input_tokens") is not None
            and usage.get("cache_read_input_tokens", 0) > 0
        ):
            event_properties["$ai_cache_read_input_tokens"] = usage.get(
                "cache_read_input_tokens", 0
            )

        if (
            usage.get("cache_creation_input_tokens") is not None
            and usage.get("cache_creation_input_tokens", 0) > 0
        ):
            event_properties["$ai_cache_creation_input_tokens"] = usage.get(
                "cache_creation_input_tokens", 0
            )

        if (
            usage.get("reasoning_tokens") is not None
            and usage.get("reasoning_tokens", 0) > 0
        ):
            event_properties["$ai_reasoning_tokens"] = usage.get("reasoning_tokens", 0)

        if posthog_distinct_id is None:
            event_properties["$process_person_profile"] = False

        # Process instructions for Responses API
        if provider == "openai" and kwargs.get("instructions") is not None:
            event_properties["$ai_instructions"] = with_privacy_mode(
                ph_client, posthog_privacy_mode, kwargs.get("instructions")
            )

        # send the event to posthog
        if hasattr(ph_client, "capture") and callable(ph_client.capture):
            ph_client.capture(
                distinct_id=posthog_distinct_id or posthog_trace_id,
                event="$ai_generation",
                properties=event_properties,
                groups=posthog_groups,
            )

    if error:
        raise error

    return response


async def call_llm_and_track_usage_async(
    posthog_distinct_id: Optional[str],
    ph_client: PostHogClient,
    provider: str,
    posthog_trace_id: Optional[str],
    posthog_properties: Optional[Dict[str, Any]],
    posthog_privacy_mode: bool,
    posthog_groups: Optional[Dict[str, Any]],
    base_url: URL,
    call_async_method: Callable[..., Any],
    **kwargs: Any,
) -> Any:
    start_time = time.time()
    response = None
    error = None
    http_status = 200
    usage: Dict[str, Any] = {}
    error_params: Dict[str, any] = {}

    try:
        response = await call_async_method(**kwargs)
    except Exception as exc:
        error = exc
        http_status = getattr(
            exc, "status_code", 0
        )  # default to 0 because its likely an SDK error
        error_params = {
            "$ai_is_error": True,
            "$ai_error": exc.__str__(),
        }
    finally:
        end_time = time.time()
        latency = end_time - start_time

        if posthog_trace_id is None:
            posthog_trace_id = str(uuid.uuid4())

        if response and (
            hasattr(response, "usage")
            or (provider == "gemini" and hasattr(response, "usage_metadata"))
        ):
            usage = get_usage(response, provider)

        messages = merge_system_prompt(kwargs, provider)

        event_properties = {
            "$ai_provider": provider,
            "$ai_model": kwargs.get("model"),
            "$ai_model_parameters": get_model_params(kwargs),
            "$ai_input": with_privacy_mode(ph_client, posthog_privacy_mode, messages),
            "$ai_output_choices": with_privacy_mode(
                ph_client, posthog_privacy_mode, format_response(response, provider)
            ),
            "$ai_http_status": http_status,
            "$ai_input_tokens": usage.get("input_tokens", 0),
            "$ai_output_tokens": usage.get("output_tokens", 0),
            "$ai_latency": latency,
            "$ai_trace_id": posthog_trace_id,
            "$ai_base_url": str(base_url),
            **(posthog_properties or {}),
            **(error_params or {}),
        }

        tool_calls = format_tool_calls(response, provider)
        if tool_calls:
            event_properties["$ai_tools"] = with_privacy_mode(
                ph_client, posthog_privacy_mode, tool_calls
            )

        if (
            usage.get("cache_read_input_tokens") is not None
            and usage.get("cache_read_input_tokens", 0) > 0
        ):
            event_properties["$ai_cache_read_input_tokens"] = usage.get(
                "cache_read_input_tokens", 0
            )

        if (
            usage.get("cache_creation_input_tokens") is not None
            and usage.get("cache_creation_input_tokens", 0) > 0
        ):
            event_properties["$ai_cache_creation_input_tokens"] = usage.get(
                "cache_creation_input_tokens", 0
            )

        if posthog_distinct_id is None:
            event_properties["$process_person_profile"] = False

        # Process instructions for Responses API
        if provider == "openai" and kwargs.get("instructions") is not None:
            event_properties["$ai_instructions"] = with_privacy_mode(
                ph_client, posthog_privacy_mode, kwargs.get("instructions")
            )

        # send the event to posthog
        if hasattr(ph_client, "capture") and callable(ph_client.capture):
            ph_client.capture(
                distinct_id=posthog_distinct_id or posthog_trace_id,
                event="$ai_generation",
                properties=event_properties,
                groups=posthog_groups,
            )

    if error:
        raise error

    return response


def with_privacy_mode(ph_client: PostHogClient, privacy_mode: bool, value: Any):
    if ph_client.privacy_mode or privacy_mode:
        return None
    return value
