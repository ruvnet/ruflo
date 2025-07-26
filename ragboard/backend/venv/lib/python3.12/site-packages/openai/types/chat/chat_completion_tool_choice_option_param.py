# File generated from our OpenAPI spec by Stainless.

from __future__ import annotations

from typing import Union
from typing_extensions import Literal

from .chat_completion_named_tool_choice_param import ChatCompletionNamedToolChoiceParam

__all__ = ["ChatCompletionToolChoiceOptionParam"]

ChatCompletionToolChoiceOptionParam = Union[Literal["none", "auto"], ChatCompletionNamedToolChoiceParam]
