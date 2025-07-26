# File generated from our OpenAPI spec by Stainless.

from __future__ import annotations

from typing import Union

from .chat_completion_tool_message_param import ChatCompletionToolMessageParam
from .chat_completion_user_message_param import ChatCompletionUserMessageParam
from .chat_completion_system_message_param import ChatCompletionSystemMessageParam
from .chat_completion_function_message_param import ChatCompletionFunctionMessageParam
from .chat_completion_assistant_message_param import ChatCompletionAssistantMessageParam

__all__ = ["ChatCompletionMessageParam"]

ChatCompletionMessageParam = Union[
    ChatCompletionSystemMessageParam,
    ChatCompletionUserMessageParam,
    ChatCompletionAssistantMessageParam,
    ChatCompletionToolMessageParam,
    ChatCompletionFunctionMessageParam,
]
