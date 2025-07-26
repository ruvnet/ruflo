# File generated from our OpenAPI spec by Stainless.

import builtins
from typing import List, Union, Optional
from typing_extensions import Literal

from ...._models import BaseModel
from .message_content_text import MessageContentText
from .message_content_image_file import MessageContentImageFile

__all__ = ["ThreadMessage", "Content"]

Content = Union[MessageContentImageFile, MessageContentText]


class ThreadMessage(BaseModel):
    id: str
    """The identifier, which can be referenced in API endpoints."""

    assistant_id: Optional[str] = None
    """
    If applicable, the ID of the
    [assistant](https://platform.openai.com/docs/api-reference/assistants) that
    authored this message.
    """

    content: List[Content]
    """The content of the message in array of text and/or images."""

    created_at: int
    """The Unix timestamp (in seconds) for when the message was created."""

    file_ids: List[str]
    """
    A list of [file](https://platform.openai.com/docs/api-reference/files) IDs that
    the assistant should use. Useful for tools like retrieval and code_interpreter
    that can access files. A maximum of 10 files can be attached to a message.
    """

    metadata: Optional[builtins.object] = None
    """Set of 16 key-value pairs that can be attached to an object.

    This can be useful for storing additional information about the object in a
    structured format. Keys can be a maximum of 64 characters long and values can be
    a maxium of 512 characters long.
    """

    object: Literal["thread.message"]
    """The object type, which is always `thread.message`."""

    role: Literal["user", "assistant"]
    """The entity that produced the message. One of `user` or `assistant`."""

    run_id: Optional[str] = None
    """
    If applicable, the ID of the
    [run](https://platform.openai.com/docs/api-reference/runs) associated with the
    authoring of this message.
    """

    thread_id: str
    """
    The [thread](https://platform.openai.com/docs/api-reference/threads) ID that
    this message belongs to.
    """
