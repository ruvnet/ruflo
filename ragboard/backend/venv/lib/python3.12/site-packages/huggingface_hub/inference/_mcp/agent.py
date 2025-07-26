from __future__ import annotations

import asyncio
from typing import AsyncGenerator, Dict, Iterable, List, Optional, Union

from huggingface_hub import ChatCompletionInputMessage, ChatCompletionStreamOutput, MCPClient

from .._providers import PROVIDER_OR_POLICY_T
from .constants import DEFAULT_SYSTEM_PROMPT, EXIT_LOOP_TOOLS, MAX_NUM_TURNS
from .types import ServerConfig


class Agent(MCPClient):
    """
    Implementation of a Simple Agent, which is a simple while loop built right on top of an [`MCPClient`].

    <Tip warning={true}>

    This class is experimental and might be subject to breaking changes in the future without prior notice.

    </Tip>

    Args:
        model (`str`, *optional*):
            The model to run inference with. Can be a model id hosted on the Hugging Face Hub, e.g. `meta-llama/Meta-Llama-3-8B-Instruct`
            or a URL to a deployed Inference Endpoint or other local or remote endpoint.
        servers (`Iterable[Dict]`):
            MCP servers to connect to. Each server is a dictionary containing a `type` key and a `config` key. The `type` key can be `"stdio"` or `"sse"`, and the `config` key is a dictionary of arguments for the server.
        provider (`str`, *optional*):
            Name of the provider to use for inference. Defaults to "auto" i.e. the first of the providers available for the model, sorted by the user's order in https://hf.co/settings/inference-providers.
            If model is a URL or `base_url` is passed, then `provider` is not used.
        base_url (`str`, *optional*):
            The base URL to run inference. Defaults to None.
        api_key (`str`, *optional*):
            Token to use for authentication. Will default to the locally Hugging Face saved token if not provided. You can also use your own provider API key to interact directly with the provider's service.
        prompt (`str`, *optional*):
            The system prompt to use for the agent. Defaults to the default system prompt in `constants.py`.
    """

    def __init__(
        self,
        *,
        model: Optional[str] = None,
        servers: Iterable[ServerConfig],
        provider: Optional[PROVIDER_OR_POLICY_T] = None,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        prompt: Optional[str] = None,
    ):
        super().__init__(model=model, provider=provider, base_url=base_url, api_key=api_key)
        self._servers_cfg = list(servers)
        self.messages: List[Union[Dict, ChatCompletionInputMessage]] = [
            {"role": "system", "content": prompt or DEFAULT_SYSTEM_PROMPT}
        ]

    async def load_tools(self) -> None:
        for cfg in self._servers_cfg:
            await self.add_mcp_server(**cfg)

    async def run(
        self,
        user_input: str,
        *,
        abort_event: Optional[asyncio.Event] = None,
    ) -> AsyncGenerator[Union[ChatCompletionStreamOutput, ChatCompletionInputMessage], None]:
        """
        Run the agent with the given user input.

        Args:
            user_input (`str`):
                The user input to run the agent with.
            abort_event (`asyncio.Event`, *optional*):
                An event that can be used to abort the agent. If the event is set, the agent will stop running.
        """
        self.messages.append({"role": "user", "content": user_input})

        num_turns: int = 0
        next_turn_should_call_tools = True

        while True:
            if abort_event and abort_event.is_set():
                return

            async for item in self.process_single_turn_with_tools(
                self.messages,
                exit_loop_tools=EXIT_LOOP_TOOLS,
                exit_if_first_chunk_no_tool=(num_turns > 0 and next_turn_should_call_tools),
            ):
                yield item

            num_turns += 1
            last = self.messages[-1]

            if last.get("role") == "tool" and last.get("name") in {t.function.name for t in EXIT_LOOP_TOOLS}:
                return

            if last.get("role") != "tool" and num_turns > MAX_NUM_TURNS:
                return

            if last.get("role") != "tool" and next_turn_should_call_tools:
                return

            next_turn_should_call_tools = last.get("role") != "tool"
