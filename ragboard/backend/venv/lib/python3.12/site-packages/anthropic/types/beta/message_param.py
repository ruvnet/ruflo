# File generated from our OpenAPI spec by Stainless.

from __future__ import annotations

from typing import List, Union
from typing_extensions import Literal, Required, TypedDict

from .text_block_param import TextBlockParam

__all__ = ["MessageParam"]


class MessageParam(TypedDict, total=False):
    content: Required[Union[str, List[TextBlockParam]]]

    role: Required[Literal["user", "assistant"]]
