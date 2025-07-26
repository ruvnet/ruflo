# File generated from our OpenAPI spec by Stainless.

from typing_extensions import Literal

from ...._models import BaseModel

__all__ = ["AssistantFile"]


class AssistantFile(BaseModel):
    id: str
    """The identifier, which can be referenced in API endpoints."""

    assistant_id: str
    """The assistant ID that the file is attached to."""

    created_at: int
    """The Unix timestamp (in seconds) for when the assistant file was created."""

    object: Literal["assistant.file"]
    """The object type, which is always `assistant.file`."""
