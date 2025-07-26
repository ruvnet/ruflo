# File generated from our OpenAPI spec by Stainless.

from typing_extensions import Literal

from ....._models import BaseModel

__all__ = ["MessageFile"]


class MessageFile(BaseModel):
    id: str
    """The identifier, which can be referenced in API endpoints."""

    created_at: int
    """The Unix timestamp (in seconds) for when the message file was created."""

    message_id: str
    """
    The ID of the [message](https://platform.openai.com/docs/api-reference/messages)
    that the [File](https://platform.openai.com/docs/api-reference/files) is
    attached to.
    """

    object: Literal["thread.message.file"]
    """The object type, which is always `thread.message.file`."""
