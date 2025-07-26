from __future__ import annotations

import sys
from pathlib import Path
from typing import List

from huggingface_hub import ChatCompletionInputTool


FILENAME_CONFIG = "agent.json"
FILENAME_PROMPT = "PROMPT.md"

DEFAULT_AGENT = {
    "model": "Qwen/Qwen2.5-72B-Instruct",
    "provider": "nebius",
    "servers": [
        {
            "type": "stdio",
            "command": "npx",
            "args": [
                "-y",
                "@modelcontextprotocol/server-filesystem",
                str(Path.home() / ("Desktop" if sys.platform == "darwin" else "")),
            ],
        },
        {
            "type": "stdio",
            "command": "npx",
            "args": ["@playwright/mcp@latest"],
        },
    ],
}


DEFAULT_SYSTEM_PROMPT = """
You are an agent - please keep going until the user’s query is completely
resolved, before ending your turn and yielding back to the user. Only terminate
your turn when you are sure that the problem is solved, or if you need more
info from the user to solve the problem.
If you are not sure about anything pertaining to the user’s request, use your
tools to read files and gather the relevant information: do NOT guess or make
up an answer.
You MUST plan extensively before each function call, and reflect extensively
on the outcomes of the previous function calls. DO NOT do this entire process
by making function calls only, as this can impair your ability to solve the
problem and think insightfully.
""".strip()

MAX_NUM_TURNS = 10

TASK_COMPLETE_TOOL: ChatCompletionInputTool = ChatCompletionInputTool.parse_obj(  # type: ignore[assignment]
    {
        "type": "function",
        "function": {
            "name": "task_complete",
            "description": "Call this tool when the task given by the user is complete",
        },
    }
)

ASK_QUESTION_TOOL: ChatCompletionInputTool = ChatCompletionInputTool.parse_obj(  # type: ignore[assignment]
    {
        "type": "function",
        "function": {
            "name": "ask_question",
            "description": "Ask the user for more info required to solve or clarify their problem.",
        },
    }
)

EXIT_LOOP_TOOLS: List[ChatCompletionInputTool] = [TASK_COMPLETE_TOOL, ASK_QUESTION_TOOL]


DEFAULT_REPO_ID = "tiny-agents/tiny-agents"
