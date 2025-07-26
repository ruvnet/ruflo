import json
import logging
from contextlib import AsyncExitStack
from datetime import timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any, AsyncIterable, Dict, List, Literal, Optional, Union, overload

from typing_extensions import NotRequired, TypeAlias, TypedDict, Unpack

from ...utils._runtime import get_hf_hub_version
from .._generated._async_client import AsyncInferenceClient
from .._generated.types import (
    ChatCompletionInputMessage,
    ChatCompletionInputTool,
    ChatCompletionStreamOutput,
    ChatCompletionStreamOutputDeltaToolCall,
)
from .._providers import PROVIDER_OR_POLICY_T
from .utils import format_result


if TYPE_CHECKING:
    from mcp import ClientSession

logger = logging.getLogger(__name__)

# Type alias for tool names
ToolName: TypeAlias = str

ServerType: TypeAlias = Literal["stdio", "sse", "http"]


class StdioServerParameters_T(TypedDict):
    command: str
    args: NotRequired[List[str]]
    env: NotRequired[Dict[str, str]]
    cwd: NotRequired[Union[str, Path, None]]


class SSEServerParameters_T(TypedDict):
    url: str
    headers: NotRequired[Dict[str, Any]]
    timeout: NotRequired[float]
    sse_read_timeout: NotRequired[float]


class StreamableHTTPParameters_T(TypedDict):
    url: str
    headers: NotRequired[dict[str, Any]]
    timeout: NotRequired[timedelta]
    sse_read_timeout: NotRequired[timedelta]
    terminate_on_close: NotRequired[bool]


class MCPClient:
    """
    Client for connecting to one or more MCP servers and processing chat completions with tools.

    <Tip warning={true}>

    This class is experimental and might be subject to breaking changes in the future without prior notice.

    </Tip>

    Args:
        model (`str`, `optional`):
            The model to run inference with. Can be a model id hosted on the Hugging Face Hub, e.g. `meta-llama/Meta-Llama-3-8B-Instruct`
            or a URL to a deployed Inference Endpoint or other local or remote endpoint.
        provider (`str`, *optional*):
            Name of the provider to use for inference. Defaults to "auto" i.e. the first of the providers available for the model, sorted by the user's order in https://hf.co/settings/inference-providers.
            If model is a URL or `base_url` is passed, then `provider` is not used.
        base_url (`str`, *optional*):
            The base URL to run inference. Defaults to None.
        api_key (`str`, `optional`):
            Token to use for authentication. Will default to the locally Hugging Face saved token if not provided. You can also use your own provider API key to interact directly with the provider's service.
    """

    def __init__(
        self,
        *,
        model: Optional[str] = None,
        provider: Optional[PROVIDER_OR_POLICY_T] = None,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
    ):
        # Initialize MCP sessions as a dictionary of ClientSession objects
        self.sessions: Dict[ToolName, "ClientSession"] = {}
        self.exit_stack = AsyncExitStack()
        self.available_tools: List[ChatCompletionInputTool] = []
        # To be able to send the model in the payload if `base_url` is provided
        if model is None and base_url is None:
            raise ValueError("At least one of `model` or `base_url` should be set in `MCPClient`.")
        self.payload_model = model
        self.client = AsyncInferenceClient(
            model=None if base_url is not None else model,
            provider=provider,
            api_key=api_key,
            base_url=base_url,
        )

    async def __aenter__(self):
        """Enter the context manager"""
        await self.client.__aenter__()
        await self.exit_stack.__aenter__()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Exit the context manager"""
        await self.client.__aexit__(exc_type, exc_val, exc_tb)
        await self.cleanup()

    async def cleanup(self):
        """Clean up resources"""
        await self.client.close()
        await self.exit_stack.aclose()

    @overload
    async def add_mcp_server(self, type: Literal["stdio"], **params: Unpack[StdioServerParameters_T]): ...

    @overload
    async def add_mcp_server(self, type: Literal["sse"], **params: Unpack[SSEServerParameters_T]): ...

    @overload
    async def add_mcp_server(self, type: Literal["http"], **params: Unpack[StreamableHTTPParameters_T]): ...

    async def add_mcp_server(self, type: ServerType, **params: Any):
        """Connect to an MCP server

        Args:
            type (`str`):
                Type of the server to connect to. Can be one of:
                - "stdio": Standard input/output server (local)
                - "sse": Server-sent events (SSE) server
                - "http": StreamableHTTP server
            **params (`Dict[str, Any]`):
                Server parameters that can be either:
                    - For stdio servers:
                        - command (str): The command to run the MCP server
                        - args (List[str], optional): Arguments for the command
                        - env (Dict[str, str], optional): Environment variables for the command
                        - cwd (Union[str, Path, None], optional): Working directory for the command
                    - For SSE servers:
                        - url (str): The URL of the SSE server
                        - headers (Dict[str, Any], optional): Headers for the SSE connection
                        - timeout (float, optional): Connection timeout
                        - sse_read_timeout (float, optional): SSE read timeout
                    - For StreamableHTTP servers:
                        - url (str): The URL of the StreamableHTTP server
                        - headers (Dict[str, Any], optional): Headers for the StreamableHTTP connection
                        - timeout (timedelta, optional): Connection timeout
                        - sse_read_timeout (timedelta, optional): SSE read timeout
                        - terminate_on_close (bool, optional): Whether to terminate on close
        """
        from mcp import ClientSession, StdioServerParameters
        from mcp import types as mcp_types

        # Determine server type and create appropriate parameters
        if type == "stdio":
            # Handle stdio server
            from mcp.client.stdio import stdio_client

            logger.info(f"Connecting to stdio MCP server with command: {params['command']} {params.get('args', [])}")

            client_kwargs = {"command": params["command"]}
            for key in ["args", "env", "cwd"]:
                if params.get(key) is not None:
                    client_kwargs[key] = params[key]
            server_params = StdioServerParameters(**client_kwargs)
            read, write = await self.exit_stack.enter_async_context(stdio_client(server_params))
        elif type == "sse":
            # Handle SSE server
            from mcp.client.sse import sse_client

            logger.info(f"Connecting to SSE MCP server at: {params['url']}")

            client_kwargs = {"url": params["url"]}
            for key in ["headers", "timeout", "sse_read_timeout"]:
                if params.get(key) is not None:
                    client_kwargs[key] = params[key]
            read, write = await self.exit_stack.enter_async_context(sse_client(**client_kwargs))
        elif type == "http":
            # Handle StreamableHTTP server
            from mcp.client.streamable_http import streamablehttp_client

            logger.info(f"Connecting to StreamableHTTP MCP server at: {params['url']}")

            client_kwargs = {"url": params["url"]}
            for key in ["headers", "timeout", "sse_read_timeout", "terminate_on_close"]:
                if params.get(key) is not None:
                    client_kwargs[key] = params[key]
            read, write, _ = await self.exit_stack.enter_async_context(streamablehttp_client(**client_kwargs))
            # ^ TODO: should be handle `get_session_id_callback`? (function to retrieve the current session ID)
        else:
            raise ValueError(f"Unsupported server type: {type}")

        session = await self.exit_stack.enter_async_context(
            ClientSession(
                read_stream=read,
                write_stream=write,
                client_info=mcp_types.Implementation(
                    name="huggingface_hub.MCPClient",
                    version=get_hf_hub_version(),
                ),
            )
        )

        logger.debug("Initializing session...")
        await session.initialize()

        # List available tools
        response = await session.list_tools()
        logger.debug("Connected to server with tools:", [tool.name for tool in response.tools])

        for tool in response.tools:
            if tool.name in self.sessions:
                logger.warning(f"Tool '{tool.name}' already defined by another server. Skipping.")
                continue

            # Map tool names to their server for later lookup
            self.sessions[tool.name] = session

            # Add tool to the list of available tools (for use in chat completions)
            self.available_tools.append(
                ChatCompletionInputTool.parse_obj_as_instance(
                    {
                        "type": "function",
                        "function": {
                            "name": tool.name,
                            "description": tool.description,
                            "parameters": tool.inputSchema,
                        },
                    }
                )
            )

    async def process_single_turn_with_tools(
        self,
        messages: List[Union[Dict, ChatCompletionInputMessage]],
        exit_loop_tools: Optional[List[ChatCompletionInputTool]] = None,
        exit_if_first_chunk_no_tool: bool = False,
    ) -> AsyncIterable[Union[ChatCompletionStreamOutput, ChatCompletionInputMessage]]:
        """Process a query using `self.model` and available tools, yielding chunks and tool outputs.

        Args:
            messages (`List[Dict]`):
                List of message objects representing the conversation history
            exit_loop_tools (`List[ChatCompletionInputTool]`, *optional*):
                List of tools that should exit the generator when called
            exit_if_first_chunk_no_tool (`bool`, *optional*):
                Exit if no tool is present in the first chunks. Default to False.

        Yields:
            [`ChatCompletionStreamOutput`] chunks or [`ChatCompletionInputMessage`] objects
        """
        # Prepare tools list based on options
        tools = self.available_tools
        if exit_loop_tools is not None:
            tools = [*exit_loop_tools, *self.available_tools]

        # Create the streaming request
        response = await self.client.chat.completions.create(
            model=self.payload_model,
            messages=messages,
            tools=tools,
            tool_choice="auto",
            stream=True,
        )

        message: Dict[str, Any] = {"role": "unknown", "content": ""}
        final_tool_calls: Dict[int, ChatCompletionStreamOutputDeltaToolCall] = {}
        num_of_chunks = 0

        # Read from stream
        async for chunk in response:
            num_of_chunks += 1
            delta = chunk.choices[0].delta if chunk.choices and len(chunk.choices) > 0 else None
            if not delta:
                continue

            # Process message
            if delta.role:
                message["role"] = delta.role
            if delta.content:
                message["content"] += delta.content

            # Process tool calls
            if delta.tool_calls:
                for tool_call in delta.tool_calls:
                    # Aggregate chunks into tool calls
                    if tool_call.index not in final_tool_calls:
                        if (
                            tool_call.function.arguments is None or tool_call.function.arguments == "{}"
                        ):  # Corner case (depends on provider)
                            tool_call.function.arguments = ""
                        final_tool_calls[tool_call.index] = tool_call

                    elif tool_call.function.arguments:
                        final_tool_calls[tool_call.index].function.arguments += tool_call.function.arguments

            # Optionally exit early if no tools in first chunks
            if exit_if_first_chunk_no_tool and num_of_chunks <= 2 and len(final_tool_calls) == 0:
                return

            # Yield each chunk to caller
            yield chunk

        # Add the assistant message with tool calls (if any) to messages
        if message["content"] or final_tool_calls:
            # if the role is unknown, set it to assistant
            if message.get("role") == "unknown":
                message["role"] = "assistant"
            # Convert final_tool_calls to the format expected by OpenAI
            if final_tool_calls:
                tool_calls_list: List[Dict[str, Any]] = []
                for tc in final_tool_calls.values():
                    tool_calls_list.append(
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments or "{}",
                            },
                        }
                    )
                message["tool_calls"] = tool_calls_list
            messages.append(message)

        # Process tool calls one by one
        for tool_call in final_tool_calls.values():
            function_name = tool_call.function.name
            try:
                function_args = json.loads(tool_call.function.arguments or "{}")
            except json.JSONDecodeError as err:
                tool_message = {
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "name": function_name,
                    "content": f"Invalid JSON generated by the model: {err}",
                }
                tool_message_as_obj = ChatCompletionInputMessage.parse_obj_as_instance(tool_message)
                messages.append(tool_message_as_obj)
                yield tool_message_as_obj
                continue  # move to next tool call

            tool_message = {"role": "tool", "tool_call_id": tool_call.id, "content": "", "name": function_name}

            # Check if this is an exit loop tool
            if exit_loop_tools and function_name in [t.function.name for t in exit_loop_tools]:
                tool_message_as_obj = ChatCompletionInputMessage.parse_obj_as_instance(tool_message)
                messages.append(tool_message_as_obj)
                yield tool_message_as_obj
                return

            # Execute tool call with the appropriate session
            session = self.sessions.get(function_name)
            if session is not None:
                try:
                    result = await session.call_tool(function_name, function_args)
                    tool_message["content"] = format_result(result)
                except Exception as err:
                    tool_message["content"] = f"Error: MCP tool call failed with error message: {err}"
            else:
                tool_message["content"] = f"Error: No session found for tool: {function_name}"

            # Yield tool message
            tool_message_as_obj = ChatCompletionInputMessage.parse_obj_as_instance(tool_message)
            messages.append(tool_message_as_obj)
            yield tool_message_as_obj
