try:
    import langchain  # noqa: F401
except ImportError:
    raise ModuleNotFoundError(
        "Please install LangChain to use this feature: 'pip install langchain'"
    )

import logging
import time
from dataclasses import dataclass
from typing import (
    Any,
    Dict,
    List,
    Optional,
    Sequence,
    Union,
    cast,
)
from uuid import UUID

from langchain.callbacks.base import BaseCallbackHandler
from langchain.schema.agent import AgentAction, AgentFinish
from langchain_core.documents import Document
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    FunctionMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_core.outputs import ChatGeneration, LLMResult
from pydantic import BaseModel

from posthog import default_client
from posthog.ai.utils import get_model_params, with_privacy_mode
from posthog.client import Client

log = logging.getLogger("posthog")


@dataclass
class SpanMetadata:
    name: str
    """Name of the run: chain name, model name, etc."""
    start_time: float
    """Start time of the run."""
    end_time: Optional[float]
    """End time of the run."""
    input: Optional[Any]
    """Input of the run: messages, prompt variables, etc."""

    @property
    def latency(self) -> float:
        if not self.end_time:
            return 0
        return self.end_time - self.start_time


@dataclass
class GenerationMetadata(SpanMetadata):
    provider: Optional[str] = None
    """Provider of the run: OpenAI, Anthropic"""
    model: Optional[str] = None
    """Model used in the run"""
    model_params: Optional[Dict[str, Any]] = None
    """Model parameters of the run: temperature, max_tokens, etc."""
    base_url: Optional[str] = None
    """Base URL of the provider's API used in the run."""
    tools: Optional[List[Dict[str, Any]]] = None
    """Tools provided to the model."""


RunMetadata = Union[SpanMetadata, GenerationMetadata]
RunMetadataStorage = Dict[UUID, RunMetadata]


class CallbackHandler(BaseCallbackHandler):
    """
    The PostHog LLM observability callback handler for LangChain.
    """

    _client: Client
    """PostHog client instance."""

    _distinct_id: Optional[Union[str, int, float, UUID]]
    """Distinct ID of the user to associate the trace with."""

    _trace_id: Optional[Union[str, int, float, UUID]]
    """Global trace ID to be sent with every event. Otherwise, the top-level run ID is used."""

    _trace_input: Optional[Any]
    """The input at the start of the trace. Any JSON object."""

    _trace_name: Optional[str]
    """Name of the trace, exposed in the UI."""

    _properties: Optional[Dict[str, Any]]
    """Global properties to be sent with every event."""

    _runs: RunMetadataStorage
    """Mapping of run IDs to run metadata as run metadata is only available on the start of generation."""

    _parent_tree: Dict[UUID, UUID]
    """
    A dictionary that maps chain run IDs to their parent chain run IDs (parent pointer tree),
    so the top level can be found from a bottom-level run ID.
    """

    def __init__(
        self,
        client: Optional[Client] = None,
        *,
        distinct_id: Optional[Union[str, int, float, UUID]] = None,
        trace_id: Optional[Union[str, int, float, UUID]] = None,
        properties: Optional[Dict[str, Any]] = None,
        privacy_mode: bool = False,
        groups: Optional[Dict[str, Any]] = None,
    ):
        """
        Args:
            client: PostHog client instance.
            distinct_id: Optional distinct ID of the user to associate the trace with.
            trace_id: Optional trace ID to use for the event.
            properties: Optional additional metadata to use for the trace.
            privacy_mode: Whether to redact the input and output of the trace.
            groups: Optional additional PostHog groups to use for the trace.
        """
        posthog_client = client or default_client
        if posthog_client is None:
            raise ValueError("PostHog client is required")
        self._client = posthog_client
        self._distinct_id = distinct_id
        self._trace_id = trace_id
        self._properties = properties or {}
        self._privacy_mode = privacy_mode
        self._groups = groups or {}
        self._runs = {}
        self._parent_tree = {}

    def on_chain_start(
        self,
        serialized: Dict[str, Any],
        inputs: Dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs,
    ):
        self._log_debug_event("on_chain_start", run_id, parent_run_id, inputs=inputs)
        self._set_parent_of_run(run_id, parent_run_id)
        self._set_trace_or_span_metadata(
            serialized, inputs, run_id, parent_run_id, **kwargs
        )

    def on_chain_end(
        self,
        outputs: Dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ):
        self._log_debug_event("on_chain_end", run_id, parent_run_id, outputs=outputs)
        self._pop_run_and_capture_trace_or_span(run_id, parent_run_id, outputs)

    def on_chain_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ):
        self._log_debug_event("on_chain_error", run_id, parent_run_id, error=error)
        self._pop_run_and_capture_trace_or_span(run_id, parent_run_id, error)

    def on_chat_model_start(
        self,
        serialized: Dict[str, Any],
        messages: List[List[BaseMessage]],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs,
    ):
        self._log_debug_event(
            "on_chat_model_start", run_id, parent_run_id, messages=messages
        )
        self._set_parent_of_run(run_id, parent_run_id)
        input = [
            _convert_message_to_dict(message) for row in messages for message in row
        ]
        self._set_llm_metadata(serialized, run_id, input, **kwargs)

    def on_llm_start(
        self,
        serialized: Dict[str, Any],
        prompts: List[str],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ):
        self._log_debug_event("on_llm_start", run_id, parent_run_id, prompts=prompts)
        self._set_parent_of_run(run_id, parent_run_id)
        self._set_llm_metadata(serialized, run_id, prompts, **kwargs)

    def on_llm_new_token(
        self,
        token: str,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        """Run on new LLM token. Only available when streaming is enabled."""
        self._log_debug_event("on_llm_new_token", run_id, parent_run_id, token=token)

    def on_llm_end(
        self,
        response: LLMResult,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ):
        """
        The callback works for both streaming and non-streaming runs. For streaming runs, the chain must set `stream_usage=True` in the LLM.
        """
        self._log_debug_event(
            "on_llm_end", run_id, parent_run_id, response=response, kwargs=kwargs
        )
        self._pop_run_and_capture_generation(run_id, parent_run_id, response)

    def on_llm_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ):
        self._log_debug_event("on_llm_error", run_id, parent_run_id, error=error)
        self._pop_run_and_capture_generation(run_id, parent_run_id, error)

    def on_tool_start(
        self,
        serialized: Optional[Dict[str, Any]],
        input_str: str,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> Any:
        self._log_debug_event(
            "on_tool_start", run_id, parent_run_id, input_str=input_str
        )
        self._set_parent_of_run(run_id, parent_run_id)
        self._set_trace_or_span_metadata(
            serialized, input_str, run_id, parent_run_id, **kwargs
        )

    def on_tool_end(
        self,
        output: str,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        self._log_debug_event("on_tool_end", run_id, parent_run_id, output=output)
        self._pop_run_and_capture_trace_or_span(run_id, parent_run_id, output)

    def on_tool_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[list[str]] = None,
        **kwargs: Any,
    ) -> Any:
        self._log_debug_event("on_tool_error", run_id, parent_run_id, error=error)
        self._pop_run_and_capture_trace_or_span(run_id, parent_run_id, error)

    def on_retriever_start(
        self,
        serialized: Optional[Dict[str, Any]],
        query: str,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> Any:
        self._log_debug_event("on_retriever_start", run_id, parent_run_id, query=query)
        self._set_parent_of_run(run_id, parent_run_id)
        self._set_trace_or_span_metadata(
            serialized, query, run_id, parent_run_id, **kwargs
        )

    def on_retriever_end(
        self,
        documents: Sequence[Document],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ):
        self._log_debug_event(
            "on_retriever_end", run_id, parent_run_id, documents=documents
        )
        self._pop_run_and_capture_trace_or_span(run_id, parent_run_id, documents)

    def on_retriever_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[list[str]] = None,
        **kwargs: Any,
    ) -> Any:
        """Run when Retriever errors."""
        self._log_debug_event("on_retriever_error", run_id, parent_run_id, error=error)
        self._pop_run_and_capture_trace_or_span(run_id, parent_run_id, error)

    def on_agent_action(
        self,
        action: AgentAction,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        """Run on agent action."""
        self._log_debug_event("on_agent_action", run_id, parent_run_id, action=action)
        self._set_parent_of_run(run_id, parent_run_id)
        self._set_trace_or_span_metadata(None, action, run_id, parent_run_id, **kwargs)

    def on_agent_finish(
        self,
        finish: AgentFinish,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        self._log_debug_event("on_agent_finish", run_id, parent_run_id, finish=finish)
        self._pop_run_and_capture_trace_or_span(run_id, parent_run_id, finish)

    def _set_parent_of_run(self, run_id: UUID, parent_run_id: Optional[UUID] = None):
        """
        Set the parent run ID for a chain run. If there is no parent, the run is the root.
        """
        if parent_run_id is not None:
            self._parent_tree[run_id] = parent_run_id

    def _pop_parent_of_run(self, run_id: UUID):
        """
        Remove the parent run ID for a chain run.
        """
        try:
            self._parent_tree.pop(run_id)
        except KeyError:
            pass

    def _find_root_run(self, run_id: UUID) -> UUID:
        """
        Finds the root ID of a chain run.
        """
        id: UUID = run_id
        while id in self._parent_tree:
            id = self._parent_tree[id]
        return id

    def _set_trace_or_span_metadata(
        self,
        serialized: Optional[Dict[str, Any]],
        input: Any,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs,
    ):
        default_name = "trace" if parent_run_id is None else "span"
        run_name = _get_langchain_run_name(serialized, **kwargs) or default_name
        self._runs[run_id] = SpanMetadata(
            name=run_name, input=input, start_time=time.time(), end_time=None
        )

    def _set_llm_metadata(
        self,
        serialized: Dict[str, Any],
        run_id: UUID,
        messages: Union[List[Dict[str, Any]], List[str]],
        metadata: Optional[Dict[str, Any]] = None,
        invocation_params: Optional[Dict[str, Any]] = None,
        **kwargs,
    ):
        run_name = _get_langchain_run_name(serialized, **kwargs) or "generation"
        generation = GenerationMetadata(
            name=run_name, input=messages, start_time=time.time(), end_time=None
        )
        if isinstance(invocation_params, dict):
            generation.model_params = get_model_params(invocation_params)
            if tools := invocation_params.get("tools"):
                generation.tools = tools
        if isinstance(metadata, dict):
            if model := metadata.get("ls_model_name"):
                generation.model = model
            if provider := metadata.get("ls_provider"):
                generation.provider = provider
        try:
            base_url = serialized["kwargs"]["openai_api_base"]
            if base_url is not None:
                generation.base_url = base_url
        except KeyError:
            pass
        self._runs[run_id] = generation

    def _pop_run_metadata(self, run_id: UUID) -> Optional[RunMetadata]:
        end_time = time.time()
        try:
            run = self._runs.pop(run_id)
        except KeyError:
            log.warning(f"No run metadata found for run {run_id}")
            return None
        run.end_time = end_time
        return run

    def _get_trace_id(self, run_id: UUID):
        trace_id = self._trace_id or self._find_root_run(run_id)
        if not trace_id:
            return run_id
        return trace_id

    def _get_parent_run_id(
        self, trace_id: Any, run_id: UUID, parent_run_id: Optional[UUID]
    ):
        """
        Replace the parent run ID with the trace ID for second level runs when a custom trace ID is set.
        """
        if parent_run_id is not None and parent_run_id not in self._parent_tree:
            return trace_id
        return parent_run_id

    def _pop_run_and_capture_trace_or_span(
        self, run_id: UUID, parent_run_id: Optional[UUID], outputs: Any
    ):
        trace_id = self._get_trace_id(run_id)
        self._pop_parent_of_run(run_id)
        run = self._pop_run_metadata(run_id)
        if not run:
            return
        if isinstance(run, GenerationMetadata):
            log.warning(
                f"Run {run_id} is a generation, but attempted to be captured as a trace or span."
            )
            return
        self._capture_trace_or_span(
            trace_id,
            run_id,
            run,
            outputs,
            self._get_parent_run_id(trace_id, run_id, parent_run_id),
        )

    def _capture_trace_or_span(
        self,
        trace_id: Any,
        run_id: UUID,
        run: SpanMetadata,
        outputs: Any,
        parent_run_id: Optional[UUID],
    ):
        event_name = "$ai_trace" if parent_run_id is None else "$ai_span"
        event_properties = {
            "$ai_trace_id": trace_id,
            "$ai_input_state": with_privacy_mode(
                self._client, self._privacy_mode, run.input
            ),
            "$ai_latency": run.latency,
            "$ai_span_name": run.name,
            "$ai_span_id": run_id,
        }
        if parent_run_id is not None:
            event_properties["$ai_parent_id"] = parent_run_id
        if self._properties:
            event_properties.update(self._properties)

        if isinstance(outputs, BaseException):
            event_properties["$ai_error"] = _stringify_exception(outputs)
            event_properties["$ai_is_error"] = True
        elif outputs is not None:
            event_properties["$ai_output_state"] = with_privacy_mode(
                self._client, self._privacy_mode, outputs
            )

        if self._distinct_id is None:
            event_properties["$process_person_profile"] = False

        self._client.capture(
            distinct_id=self._distinct_id or run_id,
            event=event_name,
            properties=event_properties,
            groups=self._groups,
        )

    def _pop_run_and_capture_generation(
        self,
        run_id: UUID,
        parent_run_id: Optional[UUID],
        response: Union[LLMResult, BaseException],
    ):
        trace_id = self._get_trace_id(run_id)
        self._pop_parent_of_run(run_id)
        run = self._pop_run_metadata(run_id)
        if not run:
            return
        if not isinstance(run, GenerationMetadata):
            log.warning(
                f"Run {run_id} is not a generation, but attempted to be captured as a generation."
            )
            return
        self._capture_generation(
            trace_id,
            run_id,
            run,
            response,
            self._get_parent_run_id(trace_id, run_id, parent_run_id),
        )

    def _capture_generation(
        self,
        trace_id: Any,
        run_id: UUID,
        run: GenerationMetadata,
        output: Union[LLMResult, BaseException],
        parent_run_id: Optional[UUID] = None,
    ):
        event_properties = {
            "$ai_trace_id": trace_id,
            "$ai_span_id": run_id,
            "$ai_span_name": run.name,
            "$ai_parent_id": parent_run_id,
            "$ai_provider": run.provider,
            "$ai_model": run.model,
            "$ai_model_parameters": run.model_params,
            "$ai_input": with_privacy_mode(self._client, self._privacy_mode, run.input),
            "$ai_http_status": 200,
            "$ai_latency": run.latency,
            "$ai_base_url": run.base_url,
        }
        if run.tools:
            event_properties["$ai_tools"] = with_privacy_mode(
                self._client,
                self._privacy_mode,
                run.tools,
            )

        if isinstance(output, BaseException):
            event_properties["$ai_http_status"] = _get_http_status(output)
            event_properties["$ai_error"] = _stringify_exception(output)
            event_properties["$ai_is_error"] = True
        else:
            # Add usage
            usage = _parse_usage(output)
            event_properties["$ai_input_tokens"] = usage.input_tokens
            event_properties["$ai_output_tokens"] = usage.output_tokens
            event_properties["$ai_cache_creation_input_tokens"] = (
                usage.cache_write_tokens
            )
            event_properties["$ai_cache_read_input_tokens"] = usage.cache_read_tokens
            event_properties["$ai_reasoning_tokens"] = usage.reasoning_tokens

            # Generation results
            generation_result = output.generations[-1]
            if isinstance(generation_result[-1], ChatGeneration):
                completions = [
                    _convert_message_to_dict(cast(ChatGeneration, generation).message)
                    for generation in generation_result
                ]
            else:
                completions = [
                    _extract_raw_esponse(generation) for generation in generation_result
                ]
            event_properties["$ai_output_choices"] = with_privacy_mode(
                self._client, self._privacy_mode, completions
            )

        if self._properties:
            event_properties.update(self._properties)

        if self._distinct_id is None:
            event_properties["$process_person_profile"] = False

        self._client.capture(
            distinct_id=self._distinct_id or trace_id,
            event="$ai_generation",
            properties=event_properties,
            groups=self._groups,
        )

    def _log_debug_event(
        self,
        event_name: str,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs,
    ):
        log.debug(
            f"Event: {event_name}, run_id: {str(run_id)[:5]}, parent_run_id: {str(parent_run_id)[:5]}, kwargs: {kwargs}"
        )


def _extract_raw_esponse(last_response):
    """Extract the response from the last response of the LLM call."""
    # We return the text of the response if not empty
    if last_response.text is not None and last_response.text.strip() != "":
        return last_response.text.strip()
    elif hasattr(last_response, "message"):
        # Additional kwargs contains the response in case of tool usage
        return last_response.message.additional_kwargs
    else:
        # Not tool usage, some LLM responses can be simply empty
        return ""


def _convert_message_to_dict(message: BaseMessage) -> Dict[str, Any]:
    # assistant message
    if isinstance(message, HumanMessage):
        message_dict = {"role": "user", "content": message.content}
    elif isinstance(message, AIMessage):
        message_dict = {"role": "assistant", "content": message.content}
    elif isinstance(message, SystemMessage):
        message_dict = {"role": "system", "content": message.content}
    elif isinstance(message, ToolMessage):
        message_dict = {"role": "tool", "content": message.content}
    elif isinstance(message, FunctionMessage):
        message_dict = {"role": "function", "content": message.content}
    else:
        message_dict = {"role": message.type, "content": str(message.content)}

    if message.additional_kwargs:
        message_dict.update(message.additional_kwargs)

    return message_dict


@dataclass
class ModelUsage:
    input_tokens: Optional[int]
    output_tokens: Optional[int]
    cache_write_tokens: Optional[int]
    cache_read_tokens: Optional[int]
    reasoning_tokens: Optional[int]


def _parse_usage_model(
    usage: Union[BaseModel, dict],
) -> ModelUsage:
    if isinstance(usage, BaseModel):
        usage = usage.__dict__

    conversion_list = [
        # https://pypi.org/project/langchain-anthropic/ (works also for Bedrock-Anthropic)
        ("input_tokens", "input"),
        ("output_tokens", "output"),
        ("cache_creation_input_tokens", "cache_write"),
        ("cache_read_input_tokens", "cache_read"),
        # https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/get-token-count
        ("prompt_token_count", "input"),
        ("candidates_token_count", "output"),
        ("cached_content_token_count", "cache_read"),
        ("thoughts_token_count", "reasoning"),
        # Bedrock: https://docs.aws.amazon.com/bedrock/latest/userguide/monitoring-cw.html#runtime-cloudwatch-metrics
        ("inputTokenCount", "input"),
        ("outputTokenCount", "output"),
        ("cacheCreationInputTokenCount", "cache_write"),
        ("cacheReadInputTokenCount", "cache_read"),
        # Bedrock Anthropic
        ("prompt_tokens", "input"),
        ("completion_tokens", "output"),
        ("cache_creation_input_tokens", "cache_write"),
        ("cache_read_input_tokens", "cache_read"),
        # langchain-ibm https://pypi.org/project/langchain-ibm/
        ("input_token_count", "input"),
        ("generated_token_count", "output"),
    ]

    parsed_usage = {}
    for model_key, type_key in conversion_list:
        if model_key in usage:
            captured_count = usage[model_key]
            final_count = (
                sum(captured_count)
                if isinstance(captured_count, list)
                else captured_count
            )  # For Bedrock, the token count is a list when streamed

            parsed_usage[type_key] = final_count

    # Caching (OpenAI & langchain 0.3.9+)
    if "input_token_details" in usage and isinstance(
        usage["input_token_details"], dict
    ):
        parsed_usage["cache_write"] = usage["input_token_details"].get("cache_creation")
        parsed_usage["cache_read"] = usage["input_token_details"].get("cache_read")

    # Reasoning (OpenAI & langchain 0.3.9+)
    if "output_token_details" in usage and isinstance(
        usage["output_token_details"], dict
    ):
        parsed_usage["reasoning"] = usage["output_token_details"].get("reasoning")

    field_mapping = {
        "input": "input_tokens",
        "output": "output_tokens",
        "cache_write": "cache_write_tokens",
        "cache_read": "cache_read_tokens",
        "reasoning": "reasoning_tokens",
    }
    return ModelUsage(
        **{
            dataclass_key: parsed_usage.get(mapped_key) or 0
            for mapped_key, dataclass_key in field_mapping.items()
        },
    )


def _parse_usage(response: LLMResult) -> ModelUsage:
    # langchain-anthropic uses the usage field
    llm_usage_keys = ["token_usage", "usage"]
    llm_usage: ModelUsage = ModelUsage(
        input_tokens=None,
        output_tokens=None,
        cache_write_tokens=None,
        cache_read_tokens=None,
        reasoning_tokens=None,
    )

    if response.llm_output is not None:
        for key in llm_usage_keys:
            if response.llm_output.get(key):
                llm_usage = _parse_usage_model(response.llm_output[key])
                break

    if hasattr(response, "generations"):
        for generation in response.generations:
            if "usage" in generation:
                llm_usage = _parse_usage_model(generation["usage"])
                break

            for generation_chunk in generation:
                if generation_chunk.generation_info and (
                    "usage_metadata" in generation_chunk.generation_info
                ):
                    llm_usage = _parse_usage_model(
                        generation_chunk.generation_info["usage_metadata"]
                    )
                    break

                message_chunk = getattr(generation_chunk, "message", {})
                response_metadata = getattr(message_chunk, "response_metadata", {})

                bedrock_anthropic_usage = (
                    response_metadata.get("usage", None)  # for Bedrock-Anthropic
                    if isinstance(response_metadata, dict)
                    else None
                )
                bedrock_titan_usage = (
                    response_metadata.get(
                        "amazon-bedrock-invocationMetrics", None
                    )  # for Bedrock-Titan
                    if isinstance(response_metadata, dict)
                    else None
                )
                ollama_usage = getattr(
                    message_chunk, "usage_metadata", None
                )  # for Ollama

                chunk_usage = (
                    bedrock_anthropic_usage or bedrock_titan_usage or ollama_usage
                )
                if chunk_usage:
                    llm_usage = _parse_usage_model(chunk_usage)
                    break

    return llm_usage


def _get_http_status(error: BaseException) -> int:
    # OpenAI: https://github.com/openai/openai-python/blob/main/src/openai/_exceptions.py
    # Anthropic: https://github.com/anthropics/anthropic-sdk-python/blob/main/src/anthropic/_exceptions.py
    # Google: https://github.com/googleapis/python-api-core/blob/main/google/api_core/exceptions.py
    status_code = getattr(error, "status_code", getattr(error, "code", 0))
    return status_code


def _get_langchain_run_name(
    serialized: Optional[Dict[str, Any]], **kwargs: Any
) -> Optional[str]:
    """Retrieve the name of a serialized LangChain runnable.

    The prioritization for the determination of the run name is as follows:
    - The value assigned to the "name" key in `kwargs`.
    - The value assigned to the "name" key in `serialized`.
    - The last entry of the value assigned to the "id" key in `serialized`.
    - "<unknown>".

    Args:
        serialized (Optional[Dict[str, Any]]): A dictionary containing the runnable's serialized data.
        **kwargs (Any): Additional keyword arguments, potentially including the 'name' override.

    Returns:
        str: The determined name of the Langchain runnable.
    """
    if "name" in kwargs and kwargs["name"] is not None:
        return kwargs["name"]
    if serialized is None:
        return None
    try:
        return serialized["name"]
    except (KeyError, TypeError):
        pass
    try:
        return serialized["id"][-1]
    except (KeyError, TypeError):
        pass
    return None


def _stringify_exception(exception: BaseException) -> str:
    description = str(exception)
    if description:
        return f"{exception.__class__.__name__}: {description}"
    return exception.__class__.__name__
