# File generated from our OpenAPI spec by Stainless.

from __future__ import annotations

from typing import List, Optional
from typing_extensions import Literal, Required, TypedDict

__all__ = ["MessageCreateParams"]


class MessageCreateParams(TypedDict, total=False):
    content: Required[str]
    """The content of the message."""

    role: Required[Literal["user"]]
    """The role of the entity that is creating the message.

    Currently only `user` is supported.
    """

    file_ids: List[str]
    """
    A list of [File](https://platform.openai.com/docs/api-reference/files) IDs that
    the message should use. There can be a maximum of 10 files attached to a
    message. Useful for tools like `retrieval` and `code_interpreter` that can
    access and use files.
    """

    metadata: Optional[object]
    """Set of 16 key-value pairs that can be attached to an object.

    This can be useful for storing additional information about the object in a
    structured format. Keys can be a maximum of 64 characters long and values can be
    a maxium of 512 characters long.
    """
