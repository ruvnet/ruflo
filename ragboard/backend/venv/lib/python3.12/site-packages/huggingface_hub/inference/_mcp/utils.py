"""
Utility functions for MCPClient and Tiny Agents.

Formatting utilities taken from the JS SDK: https://github.com/huggingface/huggingface.js/blob/main/packages/mcp-client/src/ResultFormatter.ts.
"""

import json
from pathlib import Path
from typing import TYPE_CHECKING, List, Optional, Tuple

from huggingface_hub import snapshot_download
from huggingface_hub.errors import EntryNotFoundError

from .constants import DEFAULT_AGENT, DEFAULT_REPO_ID, FILENAME_CONFIG, FILENAME_PROMPT
from .types import AgentConfig


if TYPE_CHECKING:
    from mcp import types as mcp_types


def format_result(result: "mcp_types.CallToolResult") -> str:
    """
    Formats a mcp.types.CallToolResult content into a human-readable string.

    Args:
        result (CallToolResult)
            Object returned by mcp.ClientSession.call_tool.

    Returns:
        str
            A formatted string representing the content of the result.
    """
    content = result.content

    if len(content) == 0:
        return "[No content]"

    formatted_parts: List[str] = []

    for item in content:
        if item.type == "text":
            formatted_parts.append(item.text)

        elif item.type == "image":
            formatted_parts.append(
                f"[Binary Content: Image {item.mimeType}, {_get_base64_size(item.data)} bytes]\n"
                f"The task is complete and the content accessible to the User"
            )

        elif item.type == "audio":
            formatted_parts.append(
                f"[Binary Content: Audio {item.mimeType}, {_get_base64_size(item.data)} bytes]\n"
                f"The task is complete and the content accessible to the User"
            )

        elif item.type == "resource":
            resource = item.resource

            if hasattr(resource, "text"):
                formatted_parts.append(resource.text)

            elif hasattr(resource, "blob"):
                formatted_parts.append(
                    f"[Binary Content ({resource.uri}): {resource.mimeType}, {_get_base64_size(resource.blob)} bytes]\n"
                    f"The task is complete and the content accessible to the User"
                )

    return "\n".join(formatted_parts)


def _get_base64_size(base64_str: str) -> int:
    """Estimate the byte size of a base64-encoded string."""
    # Remove any prefix like "data:image/png;base64,"
    if "," in base64_str:
        base64_str = base64_str.split(",")[1]

    padding = 0
    if base64_str.endswith("=="):
        padding = 2
    elif base64_str.endswith("="):
        padding = 1

    return (len(base64_str) * 3) // 4 - padding


def _load_agent_config(agent_path: Optional[str]) -> Tuple[AgentConfig, Optional[str]]:
    """Load server config and prompt."""

    def _read_dir(directory: Path) -> Tuple[AgentConfig, Optional[str]]:
        cfg_file = directory / FILENAME_CONFIG
        if not cfg_file.exists():
            raise FileNotFoundError(f" Config file not found in {directory}! Please make sure it exists locally")

        config: AgentConfig = json.loads(cfg_file.read_text(encoding="utf-8"))
        prompt_file = directory / FILENAME_PROMPT
        prompt: Optional[str] = prompt_file.read_text(encoding="utf-8") if prompt_file.exists() else None
        return config, prompt

    if agent_path is None:
        return DEFAULT_AGENT, None  # type: ignore[return-value]

    path = Path(agent_path).expanduser()

    if path.is_file():
        return json.loads(path.read_text(encoding="utf-8")), None

    if path.is_dir():
        return _read_dir(path)

    # fetch from the Hub
    try:
        repo_dir = Path(
            snapshot_download(
                repo_id=DEFAULT_REPO_ID,
                allow_patterns=f"{agent_path}/*",
                repo_type="dataset",
            )
        )
        return _read_dir(repo_dir / agent_path)
    except Exception as err:
        raise EntryNotFoundError(
            f" Agent {agent_path} not found in tiny-agents/tiny-agents! Please make sure it exists in https://huggingface.co/datasets/tiny-agents/tiny-agents."
        ) from err
